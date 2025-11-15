import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js";
import { 
    getAuth, 
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    sendPasswordResetEmail,
    signOut,
    onAuthStateChanged,
    updateProfile
} from "https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js";
import { 
    getFirestore,
    collection,
    addDoc,
    getDocs,
    updateDoc,
    deleteDoc,
    doc,
    query,
    where,
    orderBy,
    serverTimestamp,
    onSnapshot,
    setDoc,
    getDoc
} from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";

// ===== FIREBASE CONFIGURATION =====
// Replace these with your own Firebase project credentials
const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_AUTH_DOMAIN",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_STORAGE_BUCKET",
    messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
    appId: "YOUR_APP_ID"
};

// ===== APP STATE =====
let currentUser = null;
let assignments = [];
let chatHistory = [];
let metrics = { totalCost: 0, totalTokens: 0, chats: 0 };
let userProfile = { name: '', email: '' };

// ===== CONFIGURATION =====
// ⚠️ WARNING: Keep this key private! Do NOT commit to public Git repos!
const OPENROUTER_KEY = "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";
const AI_MODEL = "google/gemini-flash-1.5"; // UPDATED model name
const MODEL_PRICING = { input: 0.00, output: 0.00 }; // It's FREE!

// ===== INITIALIZATION =====
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

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
    recentActivityList: document.getElementById('recentActivityList'),
    homeGreeting: document.getElementById('homeGreeting'),
    activeCount: document.getElementById('activeCount'),
    completedCount: document.getElementById('completedCount'),
    totalCount: document.getElementById('totalCount'),
    searchAssignments: document.getElementById('searchAssignments'),
    addAssignmentBtn: document.getElementById('addAssignmentBtn'),
    addAssignmentModal: document.getElementById('addAssignmentModal'),
    addAssignmentForm: document.getElementById('addAssignmentForm'),
    closeModal: document.getElementById('closeModal'),
    profileSettings: document.getElementById('profileSettings'),
    toast: document.getElementById('toast')
};

// ===== AUTHENTICATION STATE =====
onAuthStateChanged(auth, async (user) => {
    console.log('Auth state changed:', user ? 'Logged in' : 'Logged out');
    
    if (user) {
        currentUser = user;
        await loadUserProfile();
        setupRealtimeListeners();
        
        // FIX: Ensure we navigate to home page after auth with small delay
        setTimeout(() => {
            showPage('homePage');
            updateProfileInfo();
            loadChatHistory();
        }, 100);
    } else {
        currentUser = null;
        userProfile = { name: '', email: '' };
        showPage('loginPage');
    }
});

// ===== USER PROFILE MANAGEMENT =====
async function loadUserProfile() {
    if (!currentUser) return;
    
    try {
        const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
        if (userDoc.exists()) {
            userProfile = userDoc.data();
        } else {
            const name = currentUser.displayName || currentUser.email.split('@')[0];
            userProfile = {
                name: name,
                email: currentUser.email,
                createdAt: serverTimestamp()
            };
            await setDoc(doc(db, 'users', currentUser.uid), userProfile);
        }
        
        localStorage.setItem('userName', userProfile.name);
    } catch (error) {
        console.error('Error loading user profile:', error);
        userProfile = {
            name: currentUser.displayName || currentUser.email.split('@')[0],
            email: currentUser.email
        };
    }
}

// ===== REALTIME LISTENERS =====
function setupRealtimeListeners() {
    if (!currentUser) return;
    
    const assignmentsQuery = query(
        collection(db, 'assignments'),
        where('userId', '==', currentUser.uid),
        orderBy('updatedAt', 'desc')
    );
    
    onSnapshot(assignmentsQuery, (snapshot) => {
        assignments = [];
        snapshot.forEach(doc => {
            assignments.push({ id: doc.id, ...doc.data() });
        });
        renderAssignments(assignments);
        updateHomeStats();
        loadHomePageData();
    }, (error) => {
        console.error('Assignments listener error:', error);
        showToast(`Failed to load assignments: ${error.message}`, 'error');
    });
}

// ===== PAGE NAVIGATION =====
function showPage(pageId) {
    console.log('Navigating to:', pageId);
    
    document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
    const targetPage = document.getElementById(pageId);
    if (!targetPage) {
        console.error('Target page not found:', pageId);
        return;
    }
    
    targetPage.classList.add('active');
    
    const sharedNav = document.getElementById('sharedBottomNav');
    if (sharedNav) {
        const isAuthPage = targetPage.classList.contains('auth-page');
        sharedNav.style.display = isAuthPage ? 'none' : 'flex';
    }
    
    // FIX: Update nav items only if nav exists
    const navItems = document.querySelectorAll('#sharedBottomNav .nav-item');
    navItems.forEach(item => {
        item.classList.remove('active');
        if (item.dataset.page === pageId) item.classList.add('active');
    });
    
    if (pageId === 'homePage') {
        loadHomePageData();
    } else if (pageId === 'profilePage') {
        loadProfileSettings();
    }
}

window.navigateTo = showPage;

// ===== EVENT LISTENERS =====
document.querySelectorAll('#sharedBottomNav .nav-item').forEach(item => {
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
        console.log('Attempting login...');
        
        await signInWithEmailAndPassword(auth, email, password);
        showToast('Login successful!', 'success');
    } catch (error) {
        console.error('Login error:', error);
        let errorMessage = 'Login failed';
        
        switch (error.code) {
            case 'auth/invalid-credential':
            case 'auth/wrong-password':
            case 'auth/user-not-found':
                errorMessage = 'Invalid email or password';
                break;
            case 'auth/invalid-email':
                errorMessage = 'Invalid email address';
                break;
            case 'auth/user-disabled':
                errorMessage = 'This account has been disabled';
                break;
            case 'auth/too-many-requests':
                errorMessage = 'Too many attempts. Try again later';
                break;
            default:
                errorMessage = error.message;
        }
        
        showToast(errorMessage, 'error');
    }
});

elements.registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('registerName').value;
    const email = document.getElementById('registerEmail').value;
    const password = document.getElementById('registerPassword').value;
    
    if (password.length < 6) {
        showToast('Password must be at least 6 characters', 'error');
        return;
    }
    
    try {
        showToast('Creating account...', 'info');
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(userCredential.user, { displayName: name });
        
        await setDoc(doc(db, 'users', userCredential.user.uid), {
            name: name,
            email: email,
            createdAt: serverTimestamp()
        });
        
        showToast('Account created successfully!', 'success');
    } catch (error) {
        console.error('Registration error:', error);
        let errorMessage = 'Registration failed';
        
        switch (error.code) {
            case 'auth/email-already-in-use':
                errorMessage = 'Email already registered';
                break;
            case 'auth/invalid-email':
                errorMessage = 'Invalid email address';
                break;
            case 'auth/weak-password':
                errorMessage = 'Password is too weak';
                break;
            default:
                errorMessage = error.message;
        }
        
        showToast(errorMessage, 'error');
    }
});

document.getElementById('showRegister').addEventListener('click', () => {
    showPage('registerPage');
});

document.getElementById('showLogin').addEventListener('click', () => {
    showPage('loginPage');
});

elements.forgotPassword.addEventListener('click', async () => {
    const email = document.getElementById('loginEmail').value;
    
    if (!email) {
        showToast('Please enter your email first', 'error');
        return;
    }
    
    try {
        await sendPasswordResetEmail(auth, email);
        showToast('Password reset email sent!', 'success');
    } catch (error) {
        console.error('Password reset error:', error);
        showToast('Failed to send reset email', 'error');
    }
});

elements.logoutBtn.addEventListener('click', async () => {
    try {
        await signOut(auth);
        assignments = [];
        chatHistory = [];
        localStorage.removeItem('chatHistory');
        showToast('Logged out successfully', 'success');
    } catch (error) {
        console.error('Logout error:', error);
        showToast('Logout failed', 'error');
    }
});

// ===== ASSIGNMENTS MANAGEMENT =====
elements.addAssignmentBtn.addEventListener('click', () => {
    elements.addAssignmentModal.style.display = 'flex';
});

elements.closeModal.addEventListener('click', () => {
    elements.addAssignmentModal.style.display = 'none';
    elements.addAssignmentForm.reset();
});

elements.addAssignmentModal.addEventListener('click', (e) => {
    if (e.target === elements.addAssignmentModal) {
        elements.addAssignmentModal.style.display = 'none';
        elements.addAssignmentForm.reset();
    }
});

elements.addAssignmentForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    if (!currentUser) {
        showToast('Please login first', 'error');
        return;
    }
    
    const assignment = {
        title: document.getElementById('assignmentTitle').value,
        description: document.getElementById('assignmentDescription').value || '',
        dueDate: document.getElementById('assignmentDueDate').value,
        subject: document.getElementById('assignmentSubject').value,
        userId: currentUser.uid,
        completed: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
    };
    
    try {
        await addDoc(collection(db, 'assignments'), assignment);
        showToast('Assignment added!', 'success');
        elements.addAssignmentModal.style.display = 'none';
        elements.addAssignmentForm.reset();
    } catch (error) {
        console.error('Error adding assignment:', error);
        showToast('Failed to add assignment', 'error');
    }
});

elements.searchAssignments.addEventListener('input', (e) => {
    const searchTerm = e.target.value.toLowerCase();
    const filtered = assignments.filter(a => 
        a.title.toLowerCase().includes(searchTerm) ||
        (a.description && a.description.toLowerCase().includes(searchTerm)) ||
        a.subject.toLowerCase().includes(searchTerm)
    );
    renderAssignments(filtered);
});

function renderAssignments(assignmentsList) {
    if (!elements.assignmentsList) return;
    
    if (assignmentsList.length === 0) {
        elements.assignmentsList.innerHTML = '<div class="empty-state">No assignments yet. Click + to add one!</div>';
        return;
    }
    
    elements.assignmentsList.innerHTML = assignmentsList.map(a => {
        const dueDate = new Date(a.dueDate);
        const isOverdue = !a.completed && dueDate < new Date();
        const daysUntil = Math.ceil((dueDate - new Date()) / (1000 * 60 * 60 * 24));
        
        return `
            <div class="assignment-card ${a.completed ? 'completed' : ''} ${isOverdue ? 'overdue' : ''}">
                <div class="assignment-header">
                    <input type="checkbox" ${a.completed ? 'checked' : ''} 
                           onchange="toggleAssignment('${a.id}', this.checked)">
                    <div class="assignment-title">${a.title}</div>
                    <div class="assignment-subject">${a.subject}</div>
                </div>
                ${a.description ? `<div class="assignment-desc">${a.description}</div>` : ''}
                <div class="assignment-footer">
                    <div class="assignment-date">
                        ${isOverdue ? '⚠️ Overdue' : daysUntil === 0 ? '📅 Due today' : `📅 ${daysUntil} days left`}
                    </div>
                    <button class="delete-btn" onclick="deleteAssignment('${a.id}')">🗑️</button>
                </div>
            </div>
        `;
    }).join('');
}

window.toggleAssignment = async (id, completed) => {
    try {
        await updateDoc(doc(db, 'assignments', id), {
            completed: completed,
            updatedAt: serverTimestamp()
        });
        showToast(completed ? 'Assignment completed! 🎉' : 'Marked as incomplete', 'success');
    } catch (error) {
        console.error('Error updating assignment:', error);
        showToast('Failed to update assignment', 'error');
    }
};

window.deleteAssignment = async (id) => {
    if (!confirm('Delete this assignment?')) return;
    
    try {
        await deleteDoc(doc(db, 'assignments', id));
        showToast('Assignment deleted', 'success');
    } catch (error) {
        console.error('Error deleting assignment:', error);
        showToast('Failed to delete assignment', 'error');
    }
};

// ===== HOME PAGE DATA =====
function loadHomePageData() {
    if (!currentUser) return;
    
    const today = new Date().toDateString();
    const recentActivities = assignments
        .filter(a => new Date(a.updatedAt?.toDate?.() || a.updatedAt).toDateString() === today)
        .slice(0, 5);
    
    if (elements.recentActivityList) {
        if (recentActivities.length === 0) {
            elements.recentActivityList.innerHTML = '<div class="empty-state">No recent activity today</div>';
        } else {
            elements.recentActivityList.innerHTML = recentActivities.map(a => `
                <div class="activity-item">
                    <div class="activity-icon">${a.completed ? '✅' : '📝'}</div>
                    <div class="activity-content">
                        <div class="activity-title">${a.title}</div>
                        <div class="activity-time">${a.subject}</div>
                    </div>
                </div>
            `).join('');
        }
    }
}

function updateHomeStats() {
    const active = assignments.filter(a => !a.completed).length;
    const completedToday = assignments.filter(a => {
        if (!a.completed) return false;
        const updateDate = new Date(a.updatedAt?.toDate?.() || a.updatedAt);
        return updateDate.toDateString() === new Date().toDateString();
    }).length;
    
    if (elements.activeCount) elements.activeCount.textContent = active;
    if (elements.completedCount) elements.completedCount.textContent = completedToday;
    if (elements.totalCount) elements.totalCount.textContent = assignments.length;
}

// ===== PROFILE SETTINGS =====
function loadProfileSettings() {
    if (!elements.profileSettings) return;
    
    const darkModeEnabled = document.body.getAttribute('data-theme') === 'dark';
    
    elements.profileSettings.innerHTML = `
        <div class="setting-item">
            <div class="setting-info">
                <div class="setting-label">Dark Mode</div>
                <div class="setting-desc">Switch between light and dark theme</div>
            </div>
            <label class="toggle">
                <input type="checkbox" id="darkModeToggle" ${darkModeEnabled ? 'checked' : ''}>
                <span class="toggle-slider"></span>
            </label>
        </div>
    `;
    
    document.getElementById('darkModeToggle').addEventListener('change', (e) => {
        const isDark = e.target.checked;
        if (isDark) {
            document.body.setAttribute('data-theme', 'dark');
        } else {
            document.body.removeAttribute('data-theme');
        }
        localStorage.setItem('darkMode', isDark);
    });
}

// ===== CHAT FUNCTIONALITY =====
elements.sendBtn.addEventListener('click', sendMessage);
elements.chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

async function sendMessage() {
    const message = elements.chatInput.value.trim();
    
    if (!message) {
        showToast('Please enter a message', 'error');
        return;
    }
    
    if (message.length > 2000) {
        showToast('Message too long (max 2000 chars)', 'error');
        return;
    }
    
    addMessage(message, 'user');
    elements.chatInput.value = '';
    elements.sendBtn.disabled = true;
    const loadingMsg = addMessage('Thinking...', 'ai', true);
    try {
        const response = await callOpenRouterWithFallback(message);
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

// ===== IMPROVED API CALL WITH BETTER ERROR HANDLING =====
async function callOpenRouter(message) {
    const startTime = performance.now();
    
    try {
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
                messages: [{ role: 'user', content: message }]
            })
        });
        
        // Get the response body first for better error messages
        const responseData = await response.json();
        
        if (!response.ok) {
            // Log the full error for debugging
            console.error('OpenRouter API Error:', responseData);
            throw new Error(`API Error ${response.status}: ${responseData.error?.message || 'Invalid request'}`);
        }
        
        const usage = responseData.usage || {};
        const promptTokens = usage.prompt_tokens || 0;
        const completionTokens = usage.completion_tokens || 0;
        const totalTokens = usage.total_tokens || 0;
        const inputCost = (promptTokens / 1000000) * MODEL_PRICING.input;
        const outputCost = (completionTokens / 1000000) * MODEL_PRICING.output;
        const totalCost = inputCost + outputCost;
        const duration = (performance.now() - startTime) / 1000;
        const speed = duration > 0 ? (completionTokens / duration).toFixed(1) : 0;
        
        return {
            content: responseData.choices[0].message.content,
            metrics: { promptTokens, completionTokens, totalTokens, totalCost, speed, duration: duration.toFixed(2) }
        };
        
    } catch (error) {
        // Log network errors too
        if (error instanceof TypeError && error.message === 'Failed to fetch') {
            throw new Error('Network error: Cannot reach OpenRouter API. Check your connection.');
        }
        throw error;
    }
}

// ===== CORS FALLBACK FUNCTION =====
async function callOpenRouterWithFallback(message) {
    try {
        return await callOpenRouter(message);
    } catch (error) {
        // If direct call fails, try with a CORS proxy
        if (error.message.includes('Network error') || error.message.includes('Failed to fetch')) {
            showToast('Trying alternative connection...', 'info');
            // Use a public CORS proxy as fallback
            const proxyUrl = 'https://cors-anywhere.herokuapp.com/';
            const originalUrl = 'https://openrouter.ai/api/v1/chat/completions';
            
            const response = await fetch(proxyUrl + originalUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${OPENROUTER_KEY}`,
                    'Content-Type': 'application/json',
                    'Origin': window.location.origin
                },
                body: JSON.stringify({
                    model: AI_MODEL,
                    messages: [{ role: 'user', content: message }]
                })
            });
            
            const responseData = await response.json();
            
            if (!response.ok) {
                throw new Error(`API Error ${response.status}: ${responseData.error?.message || 'Invalid request'}`);
            }
            
            // Process successful response
            const usage = responseData.usage || {};
            const promptTokens = usage.prompt_tokens || 0;
            const completionTokens = usage.completion_tokens || 0;
            const totalTokens = usage.total_tokens || 0;
            const inputCost = (promptTokens / 1000000) * MODEL_PRICING.input;
            const outputCost = (completionTokens / 1000000) * MODEL_PRICING.output;
            const totalCost = inputCost + outputCost;
            const duration = (performance.now() - performance.now()) / 1000;
            const speed = duration > 0 ? (completionTokens / duration).toFixed(1) : 0;
            
            return {
                content: responseData.choices[0].message.content,
                metrics: { promptTokens, completionTokens, totalTokens, totalCost, speed, duration: duration.toFixed(2) }
            };
        }
        throw error;
    }
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
    if (!currentUser || !userProfile) return;
    
    const name = userProfile.name || 'Student';
    const email = userProfile.email || currentUser.email;
    
    if (elements.profileName) elements.profileName.textContent = name;
    if (elements.profileEmail) elements.profileEmail.textContent = email;
    if (elements.profileAvatar) elements.profileAvatar.textContent = name.charAt(0).toUpperCase();
    if (elements.homeGreeting) elements.homeGreeting.textContent = `Welcome back, ${name}!`;
}

// ===== INITIALIZE APP =====
document.addEventListener('DOMContentLoaded', () => {
    const savedMetrics = localStorage.getItem('appMetrics');
    if (savedMetrics) metrics = JSON.parse(savedMetrics);
    
    const savedDarkMode = localStorage.getItem('darkMode') === 'true';
    if (savedDarkMode) {
        document.body.setAttribute('data-theme', 'dark');
    }
    
    // FIX: Ensure nav bar is hidden on initial load
    const sharedNav = document.getElementById('sharedBottomNav');
    if (sharedNav) {
        sharedNav.style.display = 'none';
    }
    
    console.log('App initialized');
});