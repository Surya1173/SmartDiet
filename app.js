/**
 * SmartDiet - AI-Powered Nutrition Assistant
 * Core Client-side Controller & Diet Engine
 */

// Gemini API Configuration
let GEMINI_API_KEY = localStorage.getItem("GEMINI_API_KEY") || "";
const GEMINI_MODEL = "gemini-1.5-flash";
function getGeminiEndpoint() {
    return `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
}


const DIET_PLANNER_SYSTEM_INSTRUCTION = `You are Clover, a friendly, encouraging, safety-first nutrition coach.
Your job is to analyze the user's profile and generate a highly personalized, practical, and nutritionally balanced 1-day meal plan and daily targets in JSON format.

Strict Rules & Safety Guidelines:
1. Calorie Restrictions: If the user is a child (under 12 years old), pregnant, or breastfeeding, set "displayCalories" to false. Do not recommend specific calorie counts or macro grams for these groups. Provide qualitative guidance instead.
2. Safety Minimums: For normal adults, never recommend a calorie target below 1200 kcal/day. If BMR/TDEE calculations with deficit suggest less than 1200 kcal/day, set "calories" to 1200 and set "limitBelow1200Warning" to true. Otherwise, calculate using Mifflin-St Jeor and activity multiplier.
3. Allergy Exclusions: Strictly check the "allergies" field. You MUST completely exclude and replace all specified allergens. For example, if allergic to peanut, replace peanut butter with pumpkin/sunflower seed butter. If lactose intolerant, replace milk with almond/soy milk.
4. Medical Strategy: Under "medicalGuidelines", provide a custom, evidence-based nutrition guideline for any listed medical condition (e.g. low-GI for diabetes, low-sodium for hypertension, anti-inflammatory for PCOS, thyroid support). If no medical condition is listed, provide general healthy eating advice.
5. Focus Nutrients: Provide 3 custom key focus nutrients/habits based on their age/stage (e.g., Calcium for kids/seniors, Iron for teens, Folate for pregnancy, Fiber for adults). Ensure each has a valid Lucide icon name (like shield, milk, smile, zap, activity, alert-circle, egg, bone, droplet, sparkle, check, heart, leaf).

The JSON output MUST match this exact schema:
{
  "calories": number (estimated daily calorie intake, e.g. 1800),
  "displayCalories": boolean (true/false),
  "limitBelow1200Warning": boolean (true/false),
  "carbs": number (estimated grams, e.g. 225),
  "protein": number (estimated grams, e.g. 90),
  "fat": number (estimated grams, e.g. 60),
  "macroSplits": {
    "carbs": number (fraction of calories, e.g. 0.50),
    "protein": number (fraction of calories, e.g. 0.20),
    "fat": number (fraction of calories, e.g. 0.30)
  },
  "meals": {
    "Breakfast": {
      "name": "string (name of dish)",
      "portion": "string (size/amount)"
    },
    "Mid-Morning Snack": {
      "name": "string (name of dish)",
      "portion": "string (size/amount)"
    },
    "Lunch": {
      "name": "string (name of dish)",
      "portion": "string (size/amount)"
    },
    "Evening Snack": {
      "name": "string (name of dish)",
      "portion": "string (size/amount)"
    },
    "Dinner": {
      "name": "string (name of dish)",
      "portion": "string (size/amount)"
    }
  },
  "focusItems": [
    {
      "icon": "string (Lucide icon name like 'shield', 'milk', 'smile', 'zap', 'activity', 'alert-circle', 'egg', 'bone', 'droplet', 'sparkle', 'check', 'heart', 'leaf')",
      "title": "string (nutrient title)",
      "desc": "string (short description)"
    }
  ],
  "medicalGuidelines": "string (guidelines matching their medical conditions)",
  "motivationalLine": "string (a encouraging motivational quote matching their goal)"
}
`;

const CHAT_ASSISTANT_SYSTEM_INSTRUCTION = `You are Clover, a friendly, encouraging, safety-first nutrition coach.
The user has completed onboarding and has their diet plan shown on the dashboard. They can now chat with you to ask questions, learn about food prep, request meal swaps, or adjust their plan.

Your Task:
Respond to the user's request. If the user asks for a change to their meal plan (e.g. "swap tofu for chicken in lunch", "can I have a gluten-free dinner?", "make it vegetarian", "increase the protein"), you must construct the updated meal plan JSON alongside your verbal reply.

Strict Rules & Safety Guidelines:
1. Keep the chat conversational and warm, but professional.
2. If they request changes to meals or targets, make sure the updated plan strictly respects their existing allergies and medical conditions!
3. If they flag disordered eating or write something unsafe, do not update their plan with restrictions. Provide NEDA support resources in your reply and ensure the plan remains safe.

The JSON output MUST match this exact schema:
{
  "reply": "string (your conversational response to the user, supporting simple markdown like **bold**, lists, and line breaks)",
  "updatedMealPlan": null OR a complete meal plan object matching the diet plan schema if you modified it. If no changes were made to their plan, set "updatedMealPlan" to null.
}
`;

// Call Gemini API via fetch client-side
async function callGeminiAPI(messages, systemInstructionText = "", isJson = false) {
    const payload = {
        contents: messages
    };

    if (systemInstructionText) {
        payload.systemInstruction = {
            parts: [{ text: systemInstructionText }]
        };
    }

    if (isJson) {
        payload.generationConfig = {
            responseMimeType: "application/json"
        };
    }

    const response = await fetch(getGeminiEndpoint(), {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gemini API returned status ${response.status}: ${errorText}`);
    }

    const result = await response.json();
    if (!result.candidates || result.candidates.length === 0 || !result.candidates[0].content || !result.candidates[0].content.parts || result.candidates[0].content.parts.length === 0) {
        throw new Error("Invalid or empty response format from Gemini API");
    }

    return result.candidates[0].content.parts[0].text;
}

// Application State
let appState = {
    step: 0, // Conversational flow step
    profile: {
        age: null,
        gender: null,
        height: null,
        weight: null,
        activity: 'sedentary',
        goal: 'general health',
        preference: 'vegetarian',
        cuisine: 'Universal/General',
        allergies: '',
        medical: ''
    },
    waterCount: 0,
    waterGoal: 8,
    disorderedEatingFlagged: false,
    directEditMode: false,
    chatHistory: []
};

// Conversational Dialog Flow Configuration
const CHAT_STEPS = {
    0: {
        question: "Hi there! I'm Clover, your friendly nutrition coach. 🌟 I'm here to help you design a safe, realistic meal plan. To get started, may I ask your **age** and **gender**?",
        field: ['age', 'gender'],
        type: 'mixed',
        chips: [
            { text: "25, Female", value: "25, female" },
            { text: "30, Male", value: "30, male" },
            { text: "65, Female", value: "65, female" },
            { text: "Pregnant", value: "30, pregnant" },
            { text: "Breastfeeding", value: "28, breastfeeding" }
        ]
    },
    1: {
        question: "Thanks! What is your **height (in cm)** and **weight (in kg)**? Knowing this helps estimate your energy needs. (Feel free to say 'skip' if you prefer not to share).",
        field: ['height', 'weight'],
        type: 'measurement',
        chips: [
            { text: "165 cm, 60 kg", value: "165, 60" },
            { text: "175 cm, 75 kg", value: "175, 75" },
            { text: "Skip height/weight", value: "skip" }
        ]
    },
    2: {
        question: "How active are you on a weekly basis? 🏃‍♀️",
        field: 'activity',
        type: 'select',
        chips: [
            { text: "Sedentary (Little to no exercise)", value: "sedentary" },
            { text: "Lightly Active (Light exercise 1-3 days/wk)", value: "lightly active" },
            { text: "Active (Moderate exercise 3-5 days/wk)", value: "active" },
            { text: "Very Active (Hard exercise 6-7 days/wk)", value: "very active" }
        ]
    },
    3: {
        question: "What is your main nutrition or dietary **goal** right now? 🎯",
        field: 'goal',
        type: 'select',
        chips: [
            { text: "General Health & Balance", value: "general health" },
            { text: "Gradual Weight Loss", value: "weight loss" },
            { text: "Healthy Weight Gain", value: "weight gain" },
            { text: "Muscle Gain / Athletic Energy", value: "muscle gain" },
            { text: "Weight Maintenance", value: "maintenance" },
            { text: "Managing a Medical Condition", value: "managing a medical condition" }
        ]
    },
    4: {
        question: "Do you have a **dietary preference** or restriction? (e.g. Vegetarian, Vegan)",
        field: 'preference',
        type: 'select',
        chips: [
            { text: "Vegetarian", value: "vegetarian" },
            { text: "Non-Vegetarian", value: "non-vegetarian" },
            { text: "Vegan", value: "vegan" },
            { text: "Eggetarian", value: "eggetarian" },
            { text: "Halal", value: "halal" },
            { text: "Jain", value: "jain" },
            { text: "Gluten-Free", value: "gluten-free" }
        ]
    },
    5: {
        question: "Which **cuisine style** do you prefer most for your meals? 🍲",
        field: 'cuisine',
        type: 'select',
        chips: [
            { text: "Indian", value: "Indian" },
            { text: "Mediterranean", value: "Mediterranean" },
            { text: "Continental", value: "Continental" },
            { text: "Universal / Balanced General", value: "Universal/General" }
        ]
    },
    6: {
        question: "Do you have any **food allergies** or foods you need to avoid? (Type 'none' if none)",
        field: 'allergies',
        type: 'text',
        chips: [
            { text: "None", value: "none" },
            { text: "Peanuts", value: "peanuts" },
            { text: "Dairy/Lactose", value: "dairy" },
            { text: "Gluten", value: "gluten" }
        ]
    },
    7: {
        question: "Finally, do you have any **existing medical conditions** we should consider? (e.g. Diabetes, PCOS, Thyroid, Hypertension - type 'none' if none) 🩺",
        field: 'medical',
        type: 'text',
        chips: [
            { text: "None", value: "none" },
            { text: "Diabetes", value: "diabetes" },
            { text: "Hypertension (High BP)", value: "hypertension" },
            { text: "PCOS / PCOD", value: "pcos" },
            { text: "Thyroid condition", value: "thyroid" }
        ]
    }
};

// Meal Database organized by Dietary Preference, Cuisine, and Goal Type
const MEAL_DATABASE = {
    "vegetarian": {
        "Indian": {
            Breakfast: ["Spiced Oats Poha with roasted peanuts and sprouts", "1 cup (200g)"],
            "Mid-Morning Snack": ["Fresh seasonal fruit salad with chia seed sprinkle", "1 bowl (150g)"],
            Lunch: ["Dal Tadka, Paneer Bhurji, 2 Multigrain Rotis, and mixed cucumber salad", "1 plate"],
            "Evening Snack": ["Dry roasted Makhana (foxnuts) with green tea", "1 cup"],
            Dinner: ["Brown rice khichdi with mixed vegetables and skimmed milk curd", "1.5 cups (300g)"]
        },
        "Mediterranean": {
            Breakfast: ["Greek yogurt topped with walnuts, honey, and fresh berries", "1 bowl"],
            "Mid-Morning Snack": ["Hummus with raw cucumber and red bell pepper slices", "3 tbsp hummus, 1 cup veggies"],
            Lunch: ["Quinoa tabouli salad with chickpeas, olives, feta cheese, and olive oil", "1 large bowl"],
            "Evening Snack": ["A handful of mixed raw almonds and pumpkin seeds", "30g"],
            Dinner: ["Baked falafel patties served over mixed greens with tahini drizzle", "3 falafels, green salad"]
        },
        "Continental": {
            Breakfast: ["Avocado smash on whole grain sourdough toast with grilled tomatoes", "2 slices toast"],
            "Mid-Morning Snack": ["Baked apple slices dusted with cinnamon", "1 medium apple"],
            Lunch: ["Grilled cottage cheese steak served with steamed broccoli and herb quinoa", "1 plate"],
            "Evening Snack": ["Mixed berries smoothie with unsweetened almond milk", "250ml"],
            Dinner: ["Creamy lentil soup alongside roasted zucchini and bell peppers", "1 large bowl"]
        },
        "Universal/General": {
            Breakfast: ["Warm oatmeal cooked in soy milk, topped with sliced banana and flaxseeds", "1 bowl"],
            "Mid-Morning Snack": ["Sliced pear with a tablespoon of natural peanut butter", "1 fruit, 1 tbsp butter"],
            Lunch: ["Whole wheat wrap stuffed with black beans, sweet corn, salsa, and avocado", "1 wrap"],
            "Evening Snack": ["Roasted chickpeas with mild sea salt seasoning", "0.5 cup"],
            Dinner: ["Stir-fry tofu with mixed garden greens, snap peas, and brown rice noodles", "1.5 cups"]
        }
    },
    "non-vegetarian": {
        "Indian": {
            Breakfast: ["Egg Bhurji (scrambled) with spinach, served with 2 wheat toasts", "2 eggs, 2 slices"],
            "Mid-Morning Snack": ["Mixed fruit bowl with a sprinkle of pumpkin seeds", "1 bowl"],
            Lunch: ["Indian chicken curry (light gravy), jeera rice, and cucumber tomato raita", "1 plate"],
            "Evening Snack": ["Boiled egg white salad with black pepper and lime juice", "2 egg whites"],
            Dinner: ["Tawa grilled fish fillet served with sautéed green beans and dal soup", "150g fish, 1 bowl dal"]
        },
        "Mediterranean": {
            Breakfast: ["Omelette with spinach, tomatoes, and feta, cooked in olive oil", "2 eggs"],
            "Mid-Morning Snack": ["Baby carrots with tzatziki dip", "1 cup carrots, 3 tbsp dip"],
            Lunch: ["Grilled chicken souvlaki skewers over Mediterranean quinoa and salad", "150g chicken, 1 cup quinoa"],
            "Evening Snack": ["A piece of low-fat cheese with a handful of grapes", "30g cheese, 10 grapes"],
            Dinner: ["Seared salmon fillet with garlic herb sauce, served with roasted asparagus", "150g salmon, 1 cup asparagus"]
        },
        "Continental": {
            Breakfast: ["Scrambled eggs, chicken breast slices, and grilled mushrooms on toast", "1 plate"],
            "Mid-Morning Snack": ["Chia seed pudding made with low-fat milk and berries", "1 glass"],
            Lunch: ["Turkey and avocado sandwich on whole grain bread with a side green salad", "1 sandwich"],
            "Evening Snack": ["Celery sticks with almond butter", "3 stalks, 1 tbsp butter"],
            Dinner: ["Herb-roasted chicken breast served alongside garlic mashed sweet potato", "150g chicken, 1 cup mash"]
        },
        "Universal/General": {
            Breakfast: ["Smoothie with whey protein, banana, spinach, and oat milk", "300ml"],
            "Mid-Morning Snack": ["Two hard-boiled eggs with a pinch of sea salt", "2 eggs"],
            Lunch: ["Tuna salad with mixed greens, cherry tomatoes, and olive oil vinaigrette", "1 plate"],
            "Evening Snack": ["A handful of walnuts and dried cranberries", "30g"],
            Dinner: ["Lean beef stir-fry (or grilled chicken) with broccoli and wild rice", "1 plate"]
        }
    },
    "vegan": {
        "Indian": {
            Breakfast: ["Besan (chickpea flour) chilla with tomatoes and spinach", "2 chillas"],
            "Mid-Morning Snack": ["Fruit bowl (papaya/pomegranate) with sunflower seeds", "1 bowl"],
            Lunch: ["Tofu bhurji, yellow dal, 2 multigrain rotis, and raw green salad", "1 plate"],
            "Evening Snack": ["Roasted chana (chickpeas) with hot green tea", "1 cup"],
            Dinner: ["Vegetable biryani cooked with brown rice, served with cucumber salad", "1.5 cups"]
        },
        "Mediterranean": {
            Breakfast: ["Sourdough toast topped with hummus, sliced cucumber, and cherry tomatoes", "2 slices toast"],
            "Mid-Morning Snack": ["Mixed raw nuts (almonds, walnuts, pistachios)", "30g"],
            Lunch: ["Chickpea and artichoke salad with red onion, parsley, and lemon dressing", "1 large bowl"],
            "Evening Snack": ["Green olives and cucumber sticks", "8 olives, 1 cup cucumber"],
            Dinner: ["Lentil pasta tossed with olives, cherry tomatoes, and fresh basil", "1 plate"]
        },
        "Continental": {
            Breakfast: ["Coconut yogurt topped with grain-free granola and raspberries", "1 bowl"],
            "Mid-Morning Snack": ["Sautéed mushrooms on a gluten-free cracker", "3 crackers"],
            Lunch: ["Lentil and vegetable loaf served with steamed green beans", "2 slices loaf"],
            "Evening Snack": ["Green juice with spinach, celery, green apple, and ginger", "250ml"],
            Dinner: ["Roasted butternut squash filled with wild rice, cranberries, and pecans", "1 plate"]
        },
        "Universal/General": {
            Breakfast: ["Oats porridge made with almond milk, topped with chia seeds and berries", "1 bowl"],
            "Mid-Morning Snack": ["Apple slices with almond butter", "1 apple, 1 tbsp butter"],
            Lunch: ["Black bean and quinoa bowl with shredded lettuce, corn, and guacamole", "1 bowl"],
            "Evening Snack": ["Roasted pumpkin seeds with sea salt", "0.25 cup"],
            Dinner: ["Tempeh stir-fry with broccoli, snap peas, and sesame brown rice", "1 plate"]
        }
    },
    "jain": {
        "Indian": {
            Breakfast: ["Moong Dal Chilla (no onion/garlic) served with tomato chutney", "2 chillas"],
            "Mid-Morning Snack": ["Apple wedges sprinkled with roasted cumin powder", "1 apple"],
            Lunch: ["Yellow mung dal, ladyfinger (bhindi) sabji, and 2 whole wheat rotis", "1 plate"],
            "Evening Snack": ["Dry roasted Makhana (foxnuts) with hot warm water/tea", "1 cup"],
            Dinner: ["Gourd (laoki) vegetable curry served with steamed brown rice", "1.5 cups"]
        },
        "Universal/General": {
            Breakfast: ["Rolled oats porridge with almond milk and almonds", "1 bowl"],
            "Mid-Morning Snack": ["Fresh papaya slices", "1 bowl"],
            Lunch: ["Warm quinoa salad tossed with bell peppers, cucumber, and chickpeas", "1 bowl"],
            "Evening Snack": ["Roasted pumpkin seeds", "30g"],
            Dinner: ["Tofu cubes stir-fried with green beans, zucchini, and cabbage in soy sauce", "1 plate"]
        }
    }
};

// Aliases for options not directly present in MEAL_DATABASE
const getPreferenceAlias = (pref) => {
    const p = pref.toLowerCase();
    if (p.includes('vegan')) return 'vegan';
    if (p.includes('jain')) return 'jain';
    if (p.includes('non-veg') || p.includes('nonveg') || p.includes('halal') || p.includes('eggetarian')) return 'non-vegetarian';
    return 'vegetarian'; // default fallback
};

const getCuisineAlias = (cuisine) => {
    if (cuisine.toLowerCase().includes('india')) return 'Indian';
    if (cuisine.toLowerCase().includes('mediter')) return 'Mediterranean';
    if (cuisine.toLowerCase().includes('conti')) return 'Continental';
    return 'Universal/General';
};

// Disordered Eating keywords dictionary
const DISORDERED_EATING_KEYWORDS = [
    "starve", "starving", "purge", "purging", "vomit", "vomiting", "hate my body", 
    "hate eating", "eat nothing", "fat and disgusting", "extreme weight loss", "obsessed with calories",
    "zero calories", "eat 500", "eat 600", "eat 700", "eat 800", "eat 400", "paper thin", "anorexia", "bulimia"
];

// Out of Scope keywords/intents
const OUT_OF_SCOPE_KEYWORDS = [
    "code", "programming", "javascript", "python", "html", "css", "politics", "president", 
    "election", "bitcoin", "crypto", "stock market", "weather", "recipe for cake", "how to build a website"
];

// Document Elements
const chatMessagesBox = document.getElementById("chat-messages-box");
const chatInputField = document.getElementById("chat-input-field");
const chatForm = document.getElementById("chat-form");
const quickRepliesContainer = document.getElementById("quick-replies-container");
const btnResetChat = document.getElementById("btn-reset-chat");
const btnApiSettings = document.getElementById("btn-api-settings");
const modalApiSettings = document.getElementById("modal-api-settings");
const btnCloseApiSettings = document.getElementById("btn-close-api-settings");
const inputApiKey = document.getElementById("input-api-key");
const btnToggleKeyVisibility = document.getElementById("btn-toggle-key-visibility");
const apiKeyStatus = document.getElementById("api-key-status");
const btnClearApiKey = document.getElementById("btn-clear-api-key");
const btnSaveApiKey = document.getElementById("btn-save-api-key");

const mainDashboardContainer = document.getElementById("main-dashboard-container");
const dashboardStatusText = document.getElementById("dashboard-status-text");
const btnToggleProfileEdit = document.getElementById("btn-toggle-profile-edit");
const btnExportPdf = document.getElementById("btn-export-pdf");

const panelWelcomeScreen = document.getElementById("panel-welcome-screen");
const panelProfileEdit = document.getElementById("panel-profile-edit");
const panelActiveDashboard = document.getElementById("panel-active-dashboard");

const btnStartDirectProfile = document.getElementById("btn-start-direct-profile");
const btnCancelProfileEdit = document.getElementById("btn-cancel-profile-edit");
const btnSaveProfile = document.getElementById("btn-save-profile");
const profileEditForm = document.getElementById("profile-edit-form");

const waterCupsContainer = document.getElementById("water-cups-container");
const btnAddWater = document.getElementById("btn-add-water");
const btnResetWater = document.getElementById("btn-reset-water");
const txtWaterCurrent = document.getElementById("txt-water-current");
const txtWaterGoal = document.getElementById("txt-water-goal");

const profileSummaryBar = document.getElementById("profile-summary-bar");
const mealTabsContainer = document.getElementById("meal-tabs-container");
const activeMealDetail = document.getElementById("active-meal-detail");

const txtTargetCalories = document.getElementById("txt-target-calories");
const circleCalorieProgress = document.getElementById("circle-calorie-progress");
const txtMacroCarbs = document.getElementById("txt-macro-carbs");
const txtMacroProtein = document.getElementById("txt-macro-protein");
const txtMacroFat = document.getElementById("txt-macro-fat");
const barMacroCarbs = document.getElementById("bar-macro-carbs");
const barMacroProtein = document.getElementById("bar-macro-protein");
const barMacroFat = document.getElementById("bar-macro-fat");

const lifestyleFocusList = document.getElementById("lifestyle-focus-list");
const txtMedicalConditionGuidelines = document.getElementById("txt-medical-condition-guidelines");
const txtMotivationalQuote = document.getElementById("txt-motivational-quote");
const dashboardDisclaimerPanel = document.getElementById("dashboard-disclaimer-panel");

// Generated Meal Plan Storage
let generatedMealPlan = null;
let currentActiveMealTab = "Breakfast";

/* ==========================================================================
   CONVERSATIONAL CHAT ENGINE
   ========================================================================== */

// Update the API Key status labels inside the settings modal
function updateApiKeyStatusUI() {
    if (GEMINI_API_KEY) {
        apiKeyStatus.innerHTML = '<span class="status-indicator status-configured"></span> API Key is configured and ready.';
        inputApiKey.value = GEMINI_API_KEY;
    } else {
        apiKeyStatus.innerHTML = '<span class="status-indicator status-unconfigured"></span> No API Key configured. Using offline database fallback.';
        inputApiKey.value = "";
    }
}

// Initialize App
function initApp() {
    // Set initial chatbot message after delay
    setTimeout(() => {
        addMessage("ai", CHAT_STEPS[0].question);
        renderQuickReplies(CHAT_STEPS[0].chips);

        if (!GEMINI_API_KEY) {
            addMessage("ai", "⚠️ **Note:** To enable live AI diet plan generation and conversational coaching, please click the 🔑 **API Key** button in the header and enter your Gemini API Key. Until then, I will use my offline database fallback.");
        }
    }, 400);

    // Event Listeners
    chatForm.addEventListener("submit", handleChatSubmit);
    btnResetChat.addEventListener("click", resetChatSession);
    btnStartDirectProfile.addEventListener("click", showProfileEditPanel);
    btnCancelProfileEdit.addEventListener("click", hideProfileEditPanel);
    profileEditForm.addEventListener("submit", handleDirectProfileSubmit);
    btnToggleProfileEdit.addEventListener("click", showProfileEditPanel);
    btnExportPdf.addEventListener("click", exportDashboardToPdf);

    // API Key Settings Modal Event Listeners
    btnApiSettings.addEventListener("click", () => {
        modalApiSettings.classList.remove("hidden");
        updateApiKeyStatusUI();
    });

    btnCloseApiSettings.addEventListener("click", () => {
        modalApiSettings.classList.add("hidden");
    });

    btnSaveApiKey.addEventListener("click", () => {
        const key = inputApiKey.value.trim();
        GEMINI_API_KEY = key;
        localStorage.setItem("GEMINI_API_KEY", key);
        updateApiKeyStatusUI();
        modalApiSettings.classList.add("hidden");
    });

    btnClearApiKey.addEventListener("click", () => {
        GEMINI_API_KEY = "";
        localStorage.removeItem("GEMINI_API_KEY");
        updateApiKeyStatusUI();
    });

    btnToggleKeyVisibility.addEventListener("click", () => {
        if (inputApiKey.type === "password") {
            inputApiKey.type = "text";
            btnToggleKeyVisibility.innerHTML = '<i data-lucide="eye-off"></i>';
        } else {
            inputApiKey.type = "password";
            btnToggleKeyVisibility.innerHTML = '<i data-lucide="eye"></i>';
        }
        lucide.createIcons();
    });

    modalApiSettings.addEventListener("click", (e) => {
        if (e.target === modalApiSettings) {
            modalApiSettings.classList.add("hidden");
        }
    });

    // Water Tracker Event Listeners
    btnAddWater.addEventListener("click", () => addWaterCup(1));
    btnResetWater.addEventListener("click", resetWaterTracker);

    // Tab switcher
    mealTabsContainer.addEventListener("click", handleMealTabClick);

    // Setup initial water tracker cups
    renderWaterCups();
}

// Add message bubble to the chat logs
function addMessage(sender, text) {
    // Remove welcome card if present
    const welcomeNote = document.querySelector(".chat-welcome-note");
    if (welcomeNote) welcomeNote.remove();

    const msgDiv = document.createElement("div");
    msgDiv.className = `message ${sender}`;

    const senderSpan = document.createElement("span");
    senderSpan.className = "message-sender";
    senderSpan.innerText = sender === "ai" ? "Coach Clover" : "You";

    const bubbleDiv = document.createElement("div");
    bubbleDiv.className = "message-bubble";
    // Using innerHTML to allow basic markdown styling (**bold**, lists)
    bubbleDiv.innerHTML = formatMarkdown(text);

    msgDiv.appendChild(senderSpan);
    msgDiv.appendChild(bubbleDiv);
    chatMessagesBox.appendChild(msgDiv);

    // Scroll to bottom
    chatMessagesBox.scrollTop = chatMessagesBox.scrollHeight;
}

// Format simple bold text
function formatMarkdown(text) {
    return text
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/\n/g, '<br>');
}

// Render dynamic choice chips
function renderQuickReplies(chips) {
    quickRepliesContainer.innerHTML = "";
    if (!chips || chips.length === 0) return;

    chips.forEach(chip => {
        const btn = document.createElement("button");
        btn.className = "quick-reply-chip";
        btn.innerText = chip.text;
        btn.dataset.value = chip.value;
        btn.addEventListener("click", () => handleQuickReplyClick(chip.text, chip.value));
        quickRepliesContainer.appendChild(btn);
    });
}

// Display typing bubbles
function showTypingIndicator() {
    const indicator = document.createElement("div");
    indicator.className = "typing-indicator message ai";
    indicator.id = "chat-typing-indicator";
    indicator.innerHTML = `
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
    `;
    chatMessagesBox.appendChild(indicator);
    chatMessagesBox.scrollTop = chatMessagesBox.scrollHeight;
}

// Hide typing bubbles
function hideTypingIndicator() {
    const indicator = document.getElementById("chat-typing-indicator");
    if (indicator) indicator.remove();
}

// Handle text input submission
function handleChatSubmit(e) {
    e.preventDefault();
    const rawInput = chatInputField.value.trim();
    if (!rawInput) return;

    chatInputField.value = "";
    processUserInput(rawInput);
}

// Handle chip click
function handleQuickReplyClick(displayText, valueText) {
    processUserInput(displayText, valueText);
}

// Central processing logic for user inputs (both text & clicks)
function processUserInput(displayText, rawValue = null) {
    const value = rawValue || displayText;
    
    // Add user message to UI
    addMessage("user", displayText);

    // Safety checks: Disordered eating
    if (detectDisorderedEating(displayText) || detectDisorderedEating(value)) {
        triggerDisorderedEatingSafetyResponse();
        return;
    }

    // Out of scope handling
    if (detectOutOfScope(displayText)) {
        triggerOutOfScopeResponse();
        return;
    }

    // Step handling state machine
    showTypingIndicator();

    if (appState.step >= 8) {
        // Handle asynchronously with Gemini API (don't use fixed 850ms timeout)
        handleGeminiChatRequest(value);
    } else {
        setTimeout(() => {
            hideTypingIndicator();
            executeStepLogic(value);
        }, 850);
    }
}

// Handle post-onboarding chat requests with live Gemini API
async function handleGeminiChatRequest(userInput) {
    try {
        // Construct chat context including the user's active profile and current plan
        const userProfile = appState.profile;
        const currentPlanContext = `
        Active Profile:
        - Age: ${userProfile.age}
        - Gender: ${userProfile.gender}
        - Height: ${userProfile.height ? userProfile.height + ' cm' : 'Not shared'}
        - Weight: ${userProfile.weight ? userProfile.weight + ' kg' : 'Not shared'}
        - Activity Level: ${userProfile.activity}
        - Dietary Goal: ${userProfile.goal}
        - Diet Preference: ${userProfile.preference}
        - Cuisine Style: ${userProfile.cuisine}
        - Allergies: ${userProfile.allergies || 'None'}
        - Medical Conditions: ${userProfile.medical || 'None'}

        Current Active Meal Plan on Dashboard:
        ${JSON.stringify(generatedMealPlan)}
        `;

        // If history is empty, initialize it
        if (!appState.chatHistory || appState.chatHistory.length === 0) {
            appState.chatHistory = [
                {
                    role: "user",
                    parts: [{ text: `Initial Profile Context:\n${currentPlanContext}` }]
                },
                {
                    role: "model",
                    parts: [{ text: "Got it! I am ready to assist as Coach Clover." }]
                }
            ];
        }

        // Add user message to history
        appState.chatHistory.push({
            role: "user",
            parts: [{ text: userInput }]
        });

        // Call Gemini
        const responseText = await callGeminiAPI(appState.chatHistory, CHAT_ASSISTANT_SYSTEM_INSTRUCTION, true);
        const parsedResponse = JSON.parse(responseText);

        hideTypingIndicator();

        // Print conversational reply
        addMessage("ai", parsedResponse.reply);

        // Add response to history
        appState.chatHistory.push({
            role: "model",
            parts: [{ text: responseText }]
        });

        // If Gemini updated the meal plan, apply changes to dashboard
        if (parsedResponse.updatedMealPlan) {
            console.log("Gemini updated the meal plan:", parsedResponse.updatedMealPlan);
            generatedMealPlan = parsedResponse.updatedMealPlan;
            updateDashboardUI();
        }

    } catch (error) {
        console.error("Gemini follow-up chat call failed.", error);
        hideTypingIndicator();
        addMessage("ai", "I'm sorry, I encountered a connection issue. Can you please repeat that? 🍎");
    }
}

// Main logic router based on current chat step
function executeStepLogic(value) {
    try {
        switch (appState.step) {
            case 0: // Age and Gender
                parseAgeAndGender(value);
                break;
            case 1: // Height and Weight
                parseHeightAndWeight(value);
                break;
            case 2: // Activity
                appState.profile.activity = value;
                advanceStep();
                break;
            case 3: // Goal
                appState.profile.goal = value;
                advanceStep();
                break;
            case 4: // Preference
                appState.profile.preference = value;
                advanceStep();
                break;
            case 5: // Cuisine
                appState.profile.cuisine = value;
                advanceStep();
                break;
            case 6: // Allergies
                appState.profile.allergies = (value.toLowerCase() === "none") ? "" : value;
                advanceStep();
                break;
            case 7: // Medical conditions
                appState.profile.medical = (value.toLowerCase() === "none") ? "" : value;
                appState.step++; // Advance to completion
                finishConversationAndGeneratePlan();
                return;
        }

        // Ask next question if not complete
        if (appState.step < 8) {
            const nextStep = CHAT_STEPS[appState.step];
            // Customize questions on the fly if needed (e.g. child rules)
            let qText = nextStep.question;
            if (appState.step === 1 && appState.profile.age !== null && appState.profile.age < 12) {
                qText = "Parents: to help support balanced growth nutrition, what is your child's **height (cm)** and **weight (kg)**? (Or click skip).";
            }
            addMessage("ai", qText);
            renderQuickReplies(nextStep.chips);
        }
    } catch (err) {
        addMessage("ai", `I didn't quite capture that. ${CHAT_STEPS[appState.step].question}`);
        renderQuickReplies(CHAT_STEPS[appState.step].chips);
    }
}

// Simple step increments
function advanceStep() {
    appState.step++;
    // Sync profile values to edit form input fields
    syncStateToForm();
}

// Regex parsing for Age & Gender
function parseAgeAndGender(input) {
    // Look for numbers for age
    const ageMatch = input.match(/\b\d+\b/);
    let parsedAge = ageMatch ? parseInt(ageMatch[0]) : null;

    let parsedGender = null;
    const lowerInput = input.toLowerCase();

    if (lowerInput.includes("pregnant")) {
        parsedGender = "pregnant";
        if (!parsedAge) parsedAge = 30; // default safe fallback if omitted
    } else if (lowerInput.includes("breastfeeding") || lowerInput.includes("nursing")) {
        parsedGender = "breastfeeding";
        if (!parsedAge) parsedAge = 28;
    } else if (lowerInput.includes("female") || lowerInput.includes("woman") || lowerInput.includes("girl") || lowerInput.includes("she")) {
        parsedGender = "female";
    } else if (lowerInput.includes("male") || lowerInput.includes("man") || lowerInput.includes("boy") || lowerInput.includes("he")) {
        parsedGender = "male";
    } else if (lowerInput.includes("other") || lowerInput.includes("prefer not")) {
        parsedGender = "other";
    }

    // Validation
    if (parsedAge === null && parsedGender === null) {
        throw new Error("Unable to parse age or gender");
    }

    if (parsedAge !== null) {
        if (parsedAge < 1 || parsedAge > 120) {
            throw new Error("Invalid age range");
        }
        appState.profile.age = parsedAge;
    } else {
        // Prompt says age is required for rules, ask specifically if they didn't supply it
        appState.profile.age = 30; // Default adult if they only selected gender
    }

    if (parsedGender !== null) {
        appState.profile.gender = parsedGender;
    } else {
        appState.profile.gender = "other";
    }

    advanceStep();
}

// Parsing Height and Weight
function parseHeightAndWeight(input) {
    const lowerInput = input.toLowerCase();
    if (lowerInput.includes("skip") || lowerInput.includes("none") || lowerInput.includes("no ")) {
        appState.profile.height = null;
        appState.profile.weight = null;
        advanceStep();
        return;
    }

    // Find all numbers
    const numbers = input.match(/\b\d+(\.\d+)?\b/g);
    
    if (numbers && numbers.length >= 2) {
        appState.profile.height = parseFloat(numbers[0]);
        appState.profile.weight = parseFloat(numbers[1]);
        advanceStep();
    } else if (numbers && numbers.length === 1) {
        // If they only put one number, we don't know which is which. Ask to try again.
        throw new Error("Need both height and weight");
    } else {
        // Assume skip if no numbers
        appState.profile.height = null;
        appState.profile.weight = null;
        advanceStep();
    }
}

// Complete flow and trigger Dashboard transition
async function finishConversationAndGeneratePlan() {
    quickRepliesContainer.innerHTML = "";
    
    // Switch state from welcome screen to active dashboard
    panelWelcomeScreen.classList.add("hidden");
    panelProfileEdit.classList.add("hidden");
    panelActiveDashboard.classList.remove("hidden");
    
    // Show Action Buttons in Header
    btnToggleProfileEdit.classList.remove("hidden");
    btnExportPdf.classList.remove("hidden");

    // Clear previous dashboard inputs & show static status
    dashboardStatusText.innerHTML = "Generating your custom plan using live AI... ⏳";
    
    // Show typing indicator in chat while generating plan
    showTypingIndicator();

    try {
        const userProfile = appState.profile;
        const promptText = `Generate a customized 1-day meal plan for:
        - Age: ${userProfile.age}
        - Gender: ${userProfile.gender}
        - Height: ${userProfile.height ? userProfile.height + ' cm' : 'Not shared'}
        - Weight: ${userProfile.weight ? userProfile.weight + ' kg' : 'Not shared'}
        - Activity Level: ${userProfile.activity}
        - Dietary Goal: ${userProfile.goal}
        - Diet Preference: ${userProfile.preference}
        - Cuisine Style: ${userProfile.cuisine}
        - Allergies: ${userProfile.allergies || 'None'}
        - Medical Conditions: ${userProfile.medical || 'None'}`;

        const messages = [{
            role: "user",
            parts: [{ text: promptText }]
        }];

        const responseText = await callGeminiAPI(messages, DIET_PLANNER_SYSTEM_INSTRUCTION, true);
        const parsedPlan = JSON.parse(responseText);

        // Update global generated plan and redraw
        generatedMealPlan = parsedPlan;
        updateDashboardUI();

        // Feed plan into chat history as baseline context
        appState.chatHistory = [
            {
                role: "user",
                parts: [{ text: promptText }]
            },
            {
                role: "model",
                parts: [{ text: `I have generated your custom meal plan successfully. Here is the initial plan:\n${JSON.stringify(parsedPlan)}` }]
            }
        ];

        hideTypingIndicator();
        addMessage("ai", `Awesome! I have analyzed your profile and generated your personalized **SmartDiet Plan** on the dashboard. 🥦✨\n\nYou can view the meal cards, macro breakdown, water tracker, and lifestyle recommendations. Let me know if you'd like to adjust anything!`);

    } catch (error) {
        console.error("Gemini API plan generation failed, falling back to local database.", error);
        hideTypingIndicator();
        
        // Fallback to offline rule-based planner
        const fallbackResults = generateDietResults();
        generatedMealPlan = fallbackResults;
        updateDashboardUI();

        addMessage("ai", `I've analyzed your profile and loaded your personalized **SmartDiet Plan** using my offline database (live AI generation was temporarily unavailable). 🥦✨\n\nYou can view the meal cards, macro breakdown, and lifestyle guidelines. Feel free to use the tracker!`);
    }
}

// Reset chat log & profile state
function resetChatSession() {
    appState = {
        step: 0,
        profile: {
            age: null,
            gender: null,
            height: null,
            weight: null,
            activity: 'sedentary',
            goal: 'general health',
            preference: 'vegetarian',
            cuisine: 'Universal/General',
            allergies: '',
            medical: ''
        },
        waterCount: 0,
        waterGoal: 8,
        disorderedEatingFlagged: false,
        directEditMode: false,
        chatHistory: []
    };
    generatedMealPlan = null;

    // UI resets
    chatMessagesBox.innerHTML = `
        <div class="chat-welcome-note">
            <div class="coach-avatar">
                <i data-lucide="sparkles"></i>
            </div>
            <h3>Meet Coach Clover!</h3>
            <p>I'm your friendly, supportive nutrition coach. I'm here to help you design a realistic, safe meal plan tailored to your lifestyle. Let's get started by chatting!</p>
        </div>
    `;
    
    // Re-trigger icon loading
    lucide.createIcons();

    // Hide dashboard elements, show welcome screen
    panelWelcomeScreen.classList.remove("hidden");
    panelProfileEdit.classList.add("hidden");
    panelActiveDashboard.classList.add("hidden");
    
    btnToggleProfileEdit.classList.add("hidden");
    btnExportPdf.classList.add("hidden");
    dashboardStatusText.innerText = "Complete the conversation with Coach Clover to unlock your custom plan.";

    resetWaterTracker();

    // Fire starting prompt
    setTimeout(() => {
        addMessage("ai", CHAT_STEPS[0].question);
        renderQuickReplies(CHAT_STEPS[0].chips);
    }, 200);
}


/* ==========================================================================
   SAFETY & AGE-BASED VALIDATORS
   ========================================================================== */

// Detect disordered eating patterns
function detectDisorderedEating(input) {
    if (!input) return false;
    const cleanInput = input.toLowerCase();
    return DISORDERED_EATING_KEYWORDS.some(keyword => cleanInput.includes(keyword));
}

// Handle disordered eating triggers
function triggerDisorderedEatingSafetyResponse() {
    appState.disorderedEatingFlagged = true;
    quickRepliesContainer.innerHTML = "";
    
    const supportiveMsg = `
    It sounds like you're going through a tough time with food and body image. Please know that you are not alone, and you deserve support. ❤️
    
    Because I care about your safety and well-being, I cannot generate calorie-restricted or numeric diet plans when there are signs of food restriction or body distress. 
    
    I encourage you to reach out to a trusted professional, doctor, or contact the **National Eating Disorders Helpline** (or equivalent in your area) for supportive guidance:
    - **NEDA Helpline:** Call or text (800) 931-2237 (or visit [nationaleatingdisorders.org](https://www.nationaleatingdisorders.org))
    
    Please take care of yourself. Let's focus on gentle nourishing, hydration, and general strength.
    `;

    addMessage("ai", supportiveMsg);

    // Update Dashboard to reflect safety override
    panelWelcomeScreen.classList.add("hidden");
    panelProfileEdit.classList.add("hidden");
    panelActiveDashboard.classList.remove("hidden");
    
    // Hide targets, show only resources
    document.getElementById("card-meal-plan-section").classList.add("hidden");
    document.getElementById("card-nutrition-goals").classList.add("hidden");
    document.getElementById("card-lifestyle-focus").classList.add("hidden");
    
    // Inject custom danger banner into disclaimer
    dashboardDisclaimerPanel.className = "warning-alert-panel danger";
    document.querySelector(".warning-text-content h4").innerText = "Support & Safety Resources";
    document.getElementById("txt-medical-condition-guidelines").innerHTML = `
        We want to support you safely. Our meal planner is locked to protect your health. 
        Please consider reaching out to a professional counselor or doctor who specializes in eating recovery. 
        <br><br>
        <strong>National Eating Disorders Association (NEDA):</strong> (800) 931-2237 (Call/Text)
    `;
}

// Detect unrelated questions (coding, politics, etc)
function detectOutOfScope(input) {
    if (!input) return false;
    const cleanInput = input.toLowerCase();
    // Check if user is asking about code, programming, politics etc.
    return OUT_OF_SCOPE_KEYWORDS.some(kw => cleanInput.includes(kw));
}

// Out of scope response redirector
function triggerOutOfScopeResponse() {
    const redirectMsg = "I'm focused on helping with diet and nutrition — want help with a meal plan or healthy eating tip instead? 🍎";
    addMessage("ai", redirectMsg);
}


/* ==========================================================================
   DIET PLANNING ENGINE (NUTRITION CALCULATION)
   ========================================================================== */

// Calculate targets and fetch matching meals
function generateDietResults() {
    const p = appState.profile;
    
    // 1. Establish Age Category Rules
    let isChild = p.age !== null && p.age < 12;
    let isTeen = p.age !== null && p.age >= 13 && p.age <= 17;
    let isSenior = p.age !== null && p.age >= 60;
    let isPregnantOrBreastfeeding = p.gender === "pregnant" || p.gender === "breastfeeding";

    // 2. Caloric & Macro Calculation (only for standard adults, locked otherwise)
    let calories = 2000; // standard baseline
    let displayCalories = true;
    let limitBelow1200Warning = false;

    if (isChild || isPregnantOrBreastfeeding) {
        displayCalories = false; // Calorie restriction is locked out
    } else {
        // Standard adult BMR calculation
        let height = p.height || 170; // fallback if skipped
        let weight = p.weight || 70;  // fallback if skipped
        let genderFactor = (p.gender === "male") ? 5 : -161;
        
        let bmr = (10 * weight) + (6.25 * height) - (5 * p.age) + genderFactor;
        
        // Activity multiplier
        let activityMultiplier = 1.2;
        if (p.activity === "lightly active") activityMultiplier = 1.375;
        if (p.activity === "active") activityMultiplier = 1.55;
        if (p.activity === "very active") activityMultiplier = 1.725;

        let tdee = Math.round(bmr * activityMultiplier);

        // Adjust based on goal
        if (p.goal === "weight loss") {
            calories = tdee - 500;
            // Never recommend below 1200 kcal/day
            if (calories < 1200) {
                calories = 1200;
                limitBelow1200Warning = true;
            }
        } else if (p.goal === "weight gain") {
            calories = tdee + 400;
        } else if (p.goal === "muscle gain") {
            calories = tdee + 300;
        } else {
            calories = tdee; // maintenance / general health
        }
    }

    // Set macro splits
    let macroSplits = { carbs: 0.50, protein: 0.20, fat: 0.30 }; // default: 50% carbs, 20% pro, 30% fat
    
    if (p.goal === "muscle gain") {
        macroSplits = { carbs: 0.45, protein: 0.25, fat: 0.30 }; // higher protein
    } else if (isSenior) {
        macroSplits = { carbs: 0.45, protein: 0.25, fat: 0.30 }; // higher protein for muscle preservation
    }

    // Calculate grams
    // Carbs: 4 kcal/g, Protein: 4 kcal/g, Fat: 9 kcal/g
    let carbGrams = Math.round((calories * macroSplits.carbs) / 4);
    let proteinGrams = Math.round((calories * macroSplits.protein) / 4);
    let fatGrams = Math.round((calories * macroSplits.fat) / 9);

    // 3. Assemble Custom Meals from Database
    const prefAlias = getPreferenceAlias(p.preference);
    const cuisineAlias = getCuisineAlias(p.cuisine);

    let mealsSource = MEAL_DATABASE[prefAlias]?.[cuisineAlias] || MEAL_DATABASE["vegetarian"]["Universal/General"];
    
    // Add variations if looking to gain muscle or lose weight (adjust portion sizes, or add extra protein suggestions)
    let finalMeals = {};
    const mealKeys = ["Breakfast", "Mid-Morning Snack", "Lunch", "Evening Snack", "Dinner"];
    
    mealKeys.forEach(key => {
        let rawMeal = mealsSource[key] || MEAL_DATABASE["vegetarian"]["Universal/General"][key];
        let name = rawMeal[0];
        let portion = rawMeal[1];

        // Portion adjustment suggestions based on Goal
        if (p.goal === "weight loss" && !isChild) {
            portion = `Moderate portion: ${portion} (keep oil/dressings minimal)`;
        } else if (p.goal === "weight gain" || p.goal === "muscle gain") {
            portion = `Generous portion: ${portion} (add 1 tbsp nuts/seeds or egg/tofu as extra side)`;
        }

        // Specific adjustments for Allergies
        if (p.allergies) {
            const allergyList = p.allergies.toLowerCase();
            if (allergyList.includes("peanut") || allergyList.includes("nut")) {
                name = name.replace(/peanut/gi, 'pumpkin seed').replace(/almond/gi, 'sunflower seed').replace(/walnut/gi, 'pumpkin seed');
            }
            if (allergyList.includes("dairy") || allergyList.includes("lactose")) {
                name = name.replace(/curd/gi, 'vegan yogurt').replace(/greek yogurt/gi, 'coconut yogurt').replace(/feta cheese/gi, 'avocado').replace(/milk/gi, 'almond milk');
            }
            if (allergyList.includes("gluten")) {
                name = name.replace(/roti/gi, 'Gluten-free Roti / Corn Tortilla').replace(/wheat/gi, 'gluten-free oats').replace(/sourdough toast/gi, 'Gluten-free toast').replace(/sandwich/gi, 'Gluten-free wrap');
            }
        }

        finalMeals[key] = { name, portion };
    });

    // 4. Formulate Lifestyle & Nutrient Focus Recommendations
    let focusItems = [];
    if (isChild) {
        focusItems.push(
            { icon: "shield", title: "Growth Nutrition", desc: "Focus on rich, wholesome whole foods. Calorie restrictions should be avoided to support normal cognitive and skeletal growth." },
            { icon: "milk", title: "Calcium & Vitamin D", desc: "Essential for building strong bones. Include milk, fortified plant milks, paneer, tofu, or yogurt." },
            { icon: "smile", title: "Healthy Relationship with Food", desc: "Focus on variety and rainbow colors on the plate. Make mealtime positive, not focused on caloric counts." }
        );
    } else if (isTeen) {
        focusItems.push(
            { icon: "zap", title: "High Energy Requirements", desc: "Teens going through growth spurts and sports training require complex carbohydrates (brown rice, oats) for sustained performance." },
            { icon: "activity", title: "Iron & Muscle Growth", desc: "Support muscle and blood volume growth. Beans, lentils, green vegetables, or lean meat are highly recommended." },
            { icon: "alert-circle", title: "Balanced Fueling", desc: "Ensure three complete balanced meals to avoid fatigue during school hours and physical workouts." }
        );
    } else if (isSenior) {
        focusItems.push(
            { icon: "egg", title: "Protein Retention", desc: "Seniors need extra protein (25-30g per main meal) to prevent age-related muscle loss (sarcopenia)." },
            { icon: "bone", title: "Bone Density Support", desc: "Calcium (1200mg/day) and Vitamin D are key. Incorporate dairy, almond milk, sesame seeds, and dark leafy greens." },
            { icon: "droplet", title: "Hydration Focus", desc: "The sensation of thirst naturally declines with age. Sip water consistently throughout the day (8+ cups target)." }
        );
    } else if (isPregnantOrBreastfeeding) {
        focusItems.push(
            { icon: "sparkle", title: "Folate & Folic Acid", desc: "Crucial for fetal development. Load up on dark green leafy vegetables, beans, and oranges." },
            { icon: "activity", title: "Iron Absorption", desc: "Double down on iron-rich foods combined with Vitamin C (like squeezing lemon on lentils) to combat gestational anemia." },
            { icon: "droplet", title: "Increased Fluids", desc: "Hydration supports amniotic fluid volume and breastmilk production. Target 10-12 cups of fluids daily." }
        );
    } else {
        // Standard adult rules
        focusItems.push(
            { icon: "check", title: "Balanced Macronutrients", desc: "A healthy split of complex carbs, lean protein sources, and monounsaturated fats supports metabolic health." },
            { icon: "heart", title: "Heart-Healthy Fats", desc: "Incorporate olive oil, walnuts, and seeds to maintain optimal cardiovascular function." },
            { icon: "leaf", title: "High Dietary Fiber", desc: "Target 25-30g of fiber daily from whole grains and vegetables to support robust digestive bacteria." }
        );
    }

    // 5. Formulate Medical Guidelines Flags
    let medicalGuidelines = "";
    if (p.medical) {
        const cond = p.medical.toLowerCase();
        if (cond.includes("diabetes") || cond.includes("sugar")) {
            medicalGuidelines = "💡 **Diabetes Diet Strategy:** Focus on low glycemic index (low-GI) carbohydrates to manage glucose levels. Space your meals evenly and pair carbs with protein/fats to stabilize insulin responses. Avoid simple sugars and refined flours.";
        } else if (cond.includes("hypertension") || cond.includes("bp") || cond.includes("blood pressure")) {
            medicalGuidelines = "💡 **Hypertension Diet Strategy:** Follow sodium-reduction guidelines. Prioritize potassium-rich foods (bananas, sweet potatoes, spinach) to support healthy vessel relaxation. Incorporate the DASH diet principles.";
        } else if (cond.includes("pcos") || cond.includes("pcod")) {
            medicalGuidelines = "💡 **PCOS Diet Strategy:** Aim for anti-inflammatory eating patterns. Focus on high-fiber foods, lean clean proteins, and healthy fats (omega-3s) to balance hormone profiles and support insulin sensitivity.";
        } else if (cond.includes("thyroid")) {
            medicalGuidelines = "💡 **Thyroid Support Strategy:** Ensure adequate iodine and selenium levels (brazil nuts are high in selenium). If you have hypothyroidism, take care with excessive intake of raw cruciferous vegetables.";
        } else {
            medicalGuidelines = `💡 **Special Health Guideline:** For managing **${p.medical}**, focus on nutrient-dense, unprocessed foods and minimize refined sugars.`;
        }
    } else {
        medicalGuidelines = "Your diet plan focuses on general wellness, clean ingredient selection, and realistic portion controls.";
    }

    // 6. Create motivational quote
    let motivationalLine = "Small daily habits lead to incredible long-term health. Keep shining!";
    if (p.goal === "weight loss") motivationalLine = "Weight wellness is a journey, not a race. Celebrate every nourishing meal choice!";
    if (p.goal === "muscle gain") motivationalLine = "Fuel your workouts, feed your muscles, and rest well. Strength is built daily!";
    if (isChild) motivationalLine = "Growing strong and having fun — nutrition is fuel for your daily adventures!";

    return {
        calories,
        displayCalories,
        limitBelow1200Warning,
        carbs: carbGrams,
        protein: proteinGrams,
        fat: fatGrams,
        macroSplits,
        meals: finalMeals,
        focusItems,
        medicalGuidelines,
        motivationalLine
    };
}


/* ==========================================================================
   UI DYNAMIC SYNC & RENDERERS
   ========================================================================== */

// Redraw the active dashboard panel based on current profile
function updateDashboardUI() {
    if (!generatedMealPlan) {
        generatedMealPlan = generateDietResults();
    }
    const results = generatedMealPlan;

    // Show or hide meal card columns if flagged
    document.getElementById("card-meal-plan-section").classList.remove("hidden");
    document.getElementById("card-nutrition-goals").classList.remove("hidden");
    document.getElementById("card-lifestyle-focus").classList.remove("hidden");

    // Reset alert colors
    dashboardDisclaimerPanel.className = "warning-alert-panel";
    document.querySelector(".warning-text-content h4").innerText = "Important Health Note";

    // Update Status Header Text
    const p = appState.profile;
    dashboardStatusText.innerHTML = `Active plan for: **${p.age} y/o ${p.gender}** | Goal: **${p.goal}**`;

    // 1. Draw Profile Summary Horizontal Tags
    profileSummaryBar.innerHTML = `
        <div class="profile-tag">Age: <strong>${p.age}</strong></div>
        <div class="profile-tag">Gender: <strong>${p.gender}</strong></div>
        ${p.height ? `<div class="profile-tag">Height: <strong>${p.height} cm</strong></div>` : ''}
        ${p.weight ? `<div class="profile-tag">Weight: <strong>${p.weight} kg</strong></div>` : ''}
        <div class="profile-tag">Activity: <strong>${p.activity}</strong></div>
        <div class="profile-tag">Goal: <strong>${p.goal}</strong></div>
        <div class="profile-tag">Diet: <strong>${p.preference}</strong></div>
        <div class="profile-tag">Cuisine: <strong>${p.cuisine}</strong></div>
        ${p.allergies ? `<div class="profile-tag danger-tag">Allergies: <strong>${p.allergies}</strong></div>` : ''}
        ${p.medical ? `<div class="profile-tag warning-tag">Medical: <strong>${p.medical}</strong></div>` : ''}
    `;

    // 2. Draw Meal Plans Detail Cards (Trigger active tab)
    renderActiveMealContent();

    // 3. Draw Target Nutrition (Calorie progress ring + Macro bars)
    if (results.displayCalories) {
        document.getElementById("card-nutrition-goals").style.display = "flex";
        txtTargetCalories.innerText = results.calories.toLocaleString();
        
        // Progress circle animations
        // Circumference is 2 * PI * r = 2 * 3.14159 * 70 = 440
        // Set dashoffset. Full circle is 440 offset.
        // Let's animate it to 85% full to look nice, or full.
        circleCalorieProgress.style.strokeDashoffset = 66; // 440 - (440 * 0.85)

        // Grams values
        txtMacroCarbs.innerText = `${results.carbs}g (${Math.round(results.macroSplits.carbs*100)}%)`;
        txtMacroProtein.innerText = `${results.protein}g (${Math.round(results.macroSplits.protein*100)}%)`;
        txtMacroFat.innerText = `${results.fat}g (${Math.round(results.macroSplits.fat*100)}%)`;

        barMacroCarbs.style.width = `${Math.round(results.macroSplits.carbs*100)}%`;
        barMacroProtein.style.width = `${Math.round(results.macroSplits.protein*100)}%`;
        barMacroFat.style.width = `${Math.round(results.macroSplits.fat*100)}%`;
    } else {
        // If child or pregnant - hide calorie counts to avoid restrictive focuses!
        txtTargetCalories.innerText = "Growth";
        circleCalorieProgress.style.strokeDashoffset = 0; // complete loop
        
        txtMacroCarbs.innerText = "Balanced Mix";
        txtMacroProtein.innerText = "Adequate Intake";
        txtMacroFat.innerText = "Healthy Fats";
        
        barMacroCarbs.style.width = "45%";
        barMacroProtein.style.width = "25%";
        barMacroFat.style.width = "30%";
    }

    // 4. Render Lifestyle/Demographic Focus Nutrients
    lifestyleFocusList.innerHTML = "";
    results.focusItems.forEach(item => {
        const li = document.createElement("li");
        li.innerHTML = `
            <div class="warning-icon-box" style="background: rgba(16, 185, 129, 0.08); color: var(--color-primary); width: 34px; height: 34px;">
                <i data-lucide="${item.icon}" style="width: 16px; height: 16px;"></i>
            </div>
            <div>
                <span class="nutrient-header">${item.title}</span>
                <span class="nutrient-desc">${item.desc}</span>
            </div>
        `;
        lifestyleFocusList.appendChild(li);
    });

    // 5. Draw Medical Guidelines guidelines disclaimer box
    let disclaimerText = results.medicalGuidelines;
    if (results.limitBelow1200Warning) {
        disclaimerText += "<br><br><span style='color: var(--color-danger); font-weight:600;'>⚠️ Note: Daily energy targets below 1200 kcal require clinical medical supervision. We have adjusted your goal to a safe baseline of 1200 kcal.</span>";
    }
    txtMedicalConditionGuidelines.innerHTML = disclaimerText;

    // 6. Draw motivational quote
    txtMotivationalQuote.innerText = `"${results.motivationalLine}"`;

    // Reinitialize lucide icons inside dashboard
    lucide.createIcons();
}

// Render active tab meal details
function renderActiveMealContent() {
    if (!generatedMealPlan) return;
    
    const mealName = currentActiveMealTab;
    const mealData = generatedMealPlan.meals[mealName];
    
    // Estimate calories per meal (approx splits: Breakfast 25%, Snack1 10%, Lunch 35%, Snack2 10%, Dinner 20%)
    let mealCal = "";
    if (generatedMealPlan.displayCalories) {
        let pct = 0.25;
        if (mealName.includes("Mid-Morning")) pct = 0.10;
        if (mealName.includes("Lunch")) pct = 0.35;
        if (mealName.includes("Evening")) pct = 0.10;
        if (mealName.includes("Dinner")) pct = 0.20;
        mealCal = `~${Math.round(generatedMealPlan.calories * pct)} kcal`;
    } else {
        mealCal = "Growth Balanced";
    }

    activeMealDetail.innerHTML = `
        <div class="meal-header-info">
            <h4 class="meal-title-tag">${mealName}</h4>
            <span class="meal-calories-badge">${mealCal}</span>
        </div>
        <ul class="meal-items-list">
            <li>
                <i data-lucide="check-circle-2"></i>
                <div>
                    <strong>${mealData.name}</strong>
                    <span class="meal-item-portion">${mealData.portion}</span>
                </div>
            </li>
            <li>
                <i data-lucide="info" style="color: var(--color-accent)"></i>
                <div style="font-size: 0.82rem; color: var(--color-text-muted)">
                    Aim to eat slowly, chew thoroughly, and practice mindful portion awareness.
                </div>
            </li>
        </ul>
    `;
    
    // Reinitialize icons in detail
    lucide.createIcons();
}

// Handle switching tabs on Meal plan card
function handleMealTabClick(e) {
    const clickedTab = e.target.closest(".meal-tab");
    if (!clickedTab) return;

    // Update active tab styling
    document.querySelectorAll(".meal-tab").forEach(tab => tab.classList.remove("active"));
    clickedTab.classList.add("active");

    currentActiveMealTab = clickedTab.dataset.meal;
    renderActiveMealContent();
}


/* ==========================================================================
   WATER LOG TRACKER SYSTEM
   ========================================================================== */

// Draw glasses of water based on count
function renderWaterCups() {
    waterCupsContainer.innerHTML = "";
    for (let i = 1; i <= appState.waterGoal; i++) {
        const wrapper = document.createElement("div");
        wrapper.className = "water-cup-wrapper";
        wrapper.dataset.index = i;
        wrapper.addEventListener("click", () => handleWaterCupClick(i));

        const cupDiv = document.createElement("div");
        cupDiv.className = `css-cup ${i <= appState.waterCount ? 'filled' : ''}`;

        const cupLip = document.createElement("div");
        cupLip.className = "css-cup-lip";

        wrapper.appendChild(cupDiv);
        wrapper.appendChild(cupLip);
        waterCupsContainer.appendChild(wrapper);
    }
}

// Toggle cup count
function handleWaterCupClick(index) {
    if (appState.waterCount >= index) {
        // Toggle down to one less than clicked index
        appState.waterCount = index - 1;
    } else {
        // Toggle up to index
        appState.waterCount = index;
    }
    updateWaterTrackerUI();
}

// Update displays
function updateWaterTrackerUI() {
    txtWaterCurrent.innerText = appState.waterCount;
    renderWaterCups();
}

// Increment water by 1
function addWaterCup(amount) {
    appState.waterCount = Math.min(appState.waterGoal, appState.waterCount + amount);
    updateWaterTrackerUI();
}

// Reset water counts
function resetWaterTracker() {
    appState.waterCount = 0;
    updateWaterTrackerUI();
}


/* ==========================================================================
   DIRECT PROFILE EDIT CONTROLS
   ========================================================================== */

// Show Edit Form Panel
function showProfileEditPanel() {
    appState.directEditMode = true;
    panelWelcomeScreen.classList.add("hidden");
    panelActiveDashboard.classList.add("hidden");
    panelProfileEdit.classList.remove("hidden");
}

// Close Edit Form Panel
function hideProfileEditPanel() {
    appState.directEditMode = false;
    panelProfileEdit.classList.add("hidden");
    
    // If they already completed setup, go back to active dashboard. Otherwise, go to welcome.
    if (appState.step >= 8) {
        panelActiveDashboard.classList.remove("hidden");
    } else {
        panelWelcomeScreen.classList.remove("hidden");
    }
}

// Synchronize profile state to Form fields
function syncStateToForm() {
    const p = appState.profile;
    if (p.age) document.getElementById("input-profile-age").value = p.age;
    if (p.gender) document.getElementById("input-profile-gender").value = p.gender;
    if (p.height) document.getElementById("input-profile-height").value = p.height;
    if (p.weight) document.getElementById("input-profile-weight").value = p.weight;
    if (p.activity) document.getElementById("input-profile-activity").value = p.activity;
    if (p.goal) document.getElementById("input-profile-goal").value = p.goal;
    if (p.preference) document.getElementById("input-profile-preference").value = p.preference;
    if (p.cuisine) document.getElementById("input-profile-cuisine").value = p.cuisine;
    if (p.allergies) document.getElementById("input-profile-allergies").value = p.allergies;
    if (p.medical) document.getElementById("input-profile-medical").value = p.medical;
}

// Process Direct Form Submission
async function handleDirectProfileSubmit(e) {
    e.preventDefault();

    const age = parseInt(document.getElementById("input-profile-age").value);
    const gender = document.getElementById("input-profile-gender").value;
    const height = document.getElementById("input-profile-height").value ? parseFloat(document.getElementById("input-profile-height").value) : null;
    const weight = document.getElementById("input-profile-weight").value ? parseFloat(document.getElementById("input-profile-weight").value) : null;
    const activity = document.getElementById("input-profile-activity").value;
    const goal = document.getElementById("input-profile-goal").value;
    const preference = document.getElementById("input-profile-preference").value;
    const cuisine = document.getElementById("input-profile-cuisine").value;
    const allergies = document.getElementById("input-profile-allergies").value.trim();
    const medical = document.getElementById("input-profile-medical").value.trim();

    // Check safety triggers on manual form fields (allergies/medical inputs could contain disordered eating triggers)
    if (detectDisorderedEating(allergies) || detectDisorderedEating(medical)) {
        triggerDisorderedEatingSafetyResponse();
        return;
    }

    // Set state
    appState.profile = { age, gender, height, weight, activity, goal, preference, cuisine, allergies, medical };
    
    // Jump conversational step to complete
    appState.step = 8;

    // Show dashboard
    panelProfileEdit.classList.add("hidden");
    panelActiveDashboard.classList.remove("hidden");
    
    // Show Action Buttons in Header
    btnToggleProfileEdit.classList.remove("hidden");
    btnExportPdf.classList.remove("hidden");

    dashboardStatusText.innerHTML = "Regenerating plan based on updated profile... ⏳";
    showTypingIndicator();

    try {
        const userProfile = appState.profile;
        const promptText = `Generate an updated customized 1-day meal plan for:
        - Age: ${userProfile.age}
        - Gender: ${userProfile.gender}
        - Height: ${userProfile.height ? userProfile.height + ' cm' : 'Not shared'}
        - Weight: ${userProfile.weight ? userProfile.weight + ' kg' : 'Not shared'}
        - Activity Level: ${userProfile.activity}
        - Dietary Goal: ${userProfile.goal}
        - Diet Preference: ${userProfile.preference}
        - Cuisine Style: ${userProfile.cuisine}
        - Allergies: ${userProfile.allergies || 'None'}
        - Medical Conditions: ${userProfile.medical || 'None'}`;

        const messages = [{
            role: "user",
            parts: [{ text: promptText }]
        }];

        const responseText = await callGeminiAPI(messages, DIET_PLANNER_SYSTEM_INSTRUCTION, true);
        const parsedPlan = JSON.parse(responseText);

        generatedMealPlan = parsedPlan;
        updateDashboardUI();

        // Reset history with updated context
        appState.chatHistory = [
            {
                role: "user",
                parts: [{ text: promptText }]
            },
            {
                role: "model",
                parts: [{ text: `I have generated your updated custom meal plan successfully. Here is the plan:\n${JSON.stringify(parsedPlan)}` }]
            }
        ];

        hideTypingIndicator();
        addMessage("ai", `🔄 **Profile Updated!** I have synchronized your dashboard details and regenerated your personalized plan using Gemini AI.`);
    } catch (error) {
        console.error("Gemini API plan update failed, falling back to local database.", error);
        hideTypingIndicator();

        const fallbackResults = generateDietResults();
        generatedMealPlan = fallbackResults;
        updateDashboardUI();

        addMessage("ai", `🔄 **Profile Updated!** I have synchronized your details and loaded the new plan using my offline database (live AI generation was temporarily unavailable).`);
    }
}


/* ==========================================================================
   EXPORT & PRINT (PDF FUNCTIONALITY)
   ========================================================================== */

function exportDashboardToPdf() {
    window.print();
}

// Startup Initialization
window.addEventListener("DOMContentLoaded", initApp);
