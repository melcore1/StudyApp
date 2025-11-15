import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js";
import { 
    getAuth, 
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    sendPasswordResetEmail,
    signOut,
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js";
import { firebaseConfig } from './firebase-config.js';

// ===== APP STATE =====
let currentUser = null;
let chatHistory = [];
let metrics = { totalCost: 0, totalTokens: 0, chats: 0 };

// ===== CONFIGURATION =====
const OPENROUTER_KEY = "sk-or-v1-YOUR_OPENROUTER_API_KEY";
const AI_MODEL = "anthropic/claude-3.5-sonnet";
const MODEL_PRICING = { input: 3.00, output: 15.00 };

// ===== INITIALIZATION =====
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// ===== DOM ELEMENTS =====
const elements = {
    loginPage: document.getElementById('loginPage'),
    registerPage: document.getElementById('registerPage'),
    homePage: document.getElementById('homePage'),
    assignmentsPage: document.getElementById('assignmentsPage'),
    chatPage: document.getElementById('chatPage'),
    profilePage: document.getElementById('profilePage'),
    loginForm: document.getElementById('loginForm'),
    registerForm: document.getElementById('registerForm'),
    forgotPassword: document.getElementById('forgotPassword'),
    logoutBtn: document.getElementById('logoutBtn'),
    chatMessages: document.getElementById('chatMessages'),
    chatInput: document.getElementById('chatInput'),
    sendBtn: document.getElementById('sendBtn'),
    metricsBar: document.getElementById('metricsBar'),
    costMetric: document.getElementById('costMetric'),
    speedMetric: document.getElementById('speedMetric'),
    tokensMetric: document.getElementById('tokensMetric'),
    profileName: document.getElementById('profileName'),
    profileEmail: document.getElementById('profileEmail'),
    profileAvatar: document.getElementById('profileAvatar'),
    assignmentsList: document.getElementById('assignmentsList'),
    profileSettings: document.getElementById('profileSettings'),
    homeRecentActivity: document.getElementById('homeRecentActivity'),
    toast: document.getElementById('toast')
};

// ===== AUTHENTICATION STATE =====
onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
        showPage('homePage');
        updateProfileInfo();
        loadChatHistory();
    } else {
        currentUser = null;
        showPage('loginPage');
    }
});

// ===== PAGE NAVIGATION =====
function showPage(pageId) {
    document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
    document.getElementById(pageId).classList.add('active');
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
        if (item.dataset.page === pageId) item.classList.add('active');
    });
}

window.navigateTo = showPage;

// ===== EVENT LISTENERS =====
document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
        e.preventDefault();
        showPage(item.dataset.page);
    });
});

elements.loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    try {
        showToast('Logging in...', 'info');
        await signInWithEmailAndPassword(auth, email, password);
        showToast('Welcome back!', 'success');
    } catch (error) {
        showToast(error.message, 'error');
    }
});

elements.registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('registerEmail').value;
    const password = document.getElementById('registerPassword').value;
    const name = document.getElementById('registerName').value;
    try {
        showToast('Creating account...', 'info');
        await createUserWithEmailAndPassword(auth, email, password);
        localStorage.setItem('userName', name);
        showToast('Account created!', 'success');
    } catch (error) {
        showToast(error.message, 'error');
    }
});

document.getElementById('showRegister').addEventListener('click', () => showPage('registerPage'));
document.getElementById('showLogin').addEventListener('click', () => showPage('loginPage'));

elements.forgotPassword.addEventListener('click', async (e) => {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value;
    if (!email) return showToast('Enter email first', 'error');
    try {
        await sendPasswordResetEmail(auth, email);
        showToast('Reset email sent!', 'success');
    } catch (error) {
        showToast(error.message, 'error');
    }
});

elements.logoutBtn.addEventListener('click', async () => {
    try {
        await signOut(auth);
        showToast('Logged out', 'success');
        localStorage.removeItem('userName');
    } catch (error) {
        showToast(error.message, 'error');
    }
});

// ===== CHAT FUNCTIONALITY =====
elements.sendBtn.addEventListener('click', sendMessage);
elements.chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});

async function sendMessage() {
    const message = elements.chatInput.value.trim();
    if (!message) return;
    addMessage(message, 'user');
    elements.chatInput.value = '';
    elements.sendBtn.disabled = true;
    const loadingMsg = addMessage('Thinking...', 'ai', true);
    try {
        const response = await callOpenRouter(message);
        loadingMsg.remove();
        addMessage(response.content, 'ai');
        updateMetrics(response.metrics);
        saveChatHistory(message, response.content, response.metrics);
    } catch (error) {
        loadingMsg.remove();
        addMessage('Error occurred. Try again.', 'ai');
        showToast(error.message, 'error');
    } finally {
        elements.sendBtn.disabled = false;
    }
}

async function callOpenRouter(message) {
    const startTime = performance.now();
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${OPENROUTER_KEY}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': window.location.origin,
            'X-Title': 'StudyApp'
        },
        body: JSON.stringify({
            model: AI_MODEL,
            messages: [{ role: 'user', content: message }],
            stream: false
        })
    });
    if (!response.ok) throw new Error(`API Error: ${response.status}`);
    const data = await response.json();
    const endTime = performance.now();
    const usage = data.usage || {};
    const promptTokens = usage.prompt_tokens || 0;
    const completionTokens = usage.completion_tokens || 0;
    const totalTokens = usage.total_tokens || 0;
    const inputCost = (promptTokens / 1000000) * MODEL_PRICING.input;
    const outputCost = (completionTokens / 1000000) * MODEL_PRICING.output;
    const totalCost = inputCost + outputCost;
    const duration = (endTime - startTime) / 1000;
    const speed = duration > 0 ? (completionTokens / duration).toFixed(1) : 0;
    return {
        content: data.choices[0].message.content,
        metrics: { promptTokens, completionTokens, totalTokens, totalCost, speed, duration: duration.toFixed(2) }
    };
}

function addMessage(content, sender, isLoading = false) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${sender}`;
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    if (isLoading) {
        bubble.innerHTML = '<div class="spinner" style="width: 20px; height: 20px; border-width: 2px;"></div>';
    } else {
        bubble.textContent = content;
    }
    const time = document.createElement('div');
    time.className = 'message-time';
    time.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    messageDiv.appendChild(bubble);
    messageDiv.appendChild(time);
    elements.chatMessages.appendChild(messageDiv);
    elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
    return messageDiv;
}

function updateMetrics(metrics) {
    elements.metricsBar.style.display = 'flex';
    elements.costMetric.textContent = metrics.totalCost.toFixed(4);
    elements.speedMetric.textContent = metrics.speed;
    elements.tokensMetric.textContent = metrics.totalTokens;
}

function saveChatHistory(userMsg, aiMsg, metrics) {
    chatHistory.push({ timestamp: Date.now(), user: userMsg, ai: aiMsg, metrics });
    if (chatHistory.length > 50) chatHistory = chatHistory.slice(-50);
    localStorage.setItem('chatHistory', JSON.stringify(chatHistory));
}

function loadChatHistory() {
    elements.chatMessages.innerHTML = '';
    chatHistory.forEach(chat => {
        addMessage(chat.user, 'user');
        addMessage(chat.ai, 'ai');
    });
}

// ===== UTILITY FUNCTIONS =====
function showToast(message, type = 'info') {
    const toast = elements.toast;
    toast.textContent = message;
    toast.className = `toast ${type}`;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
}

function updateProfileInfo() {
    if (!currentUser) return;
    const displayName = localStorage.getItem('userName') || currentUser.email.split('@')[0];
    elements.profileName.textContent = displayName;
    elements.profileEmail.textContent = currentUser.email;
    elements.profileAvatar.textContent = displayName.charAt(0).toUpperCase();
}

// ===== INITIALIZE APP =====
document.addEventListener('DOMContentLoaded', () => {
    const savedMetrics = localStorage.getItem('appMetrics');
    if (savedMetrics) metrics = JSON.parse(savedMetrics);
});