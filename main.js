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
import { firebaseConfig } from './firebase-config.js';

// ===== APP STATE =====
let currentUser = null;
let assignments = [];
let chatHistory = [];
let metrics = { totalCost: 0, totalTokens: 0, chats: 0 };
let userProfile = { name: '', email: '' };

// ===== CONFIGURATION =====
// ⚠️ WARNING: Keep this key private! Do NOT commit to public Git repos!
const OPENROUTER_KEY = "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";
const AI_MODEL = "meta-llama/llama-3.2-3b-instruct:free"; // Reliable free model
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
        
        // Initialize AI in background with system prompt
        initializeAIBackground().catch(err => {
            console.warn('Background AI init failed (non-critical):', err);
        });
        
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
        
        // FIX: Store the result and wait for auth state change
        const result = await signInWithEmailAndPassword(auth, email, password);
        console.log('Login successful:', result.user.uid);
        
        // Give auth state change time to process
        await new Promise(resolve => setTimeout(resolve, 300));
        
        // Explicitly navigate to home page
        showPage('homePage');
        showToast('Welcome back!', 'success');
        
    } catch (error) {
        console.error('Login error:', error);
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
        const result = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(result.user, { displayName: name });
        
        await setDoc(doc(db, 'users', result.user.uid), {
            name: name,
            email: email,
            createdAt: serverTimestamp()
        });
        
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
    console.log('🔄 Forgot Password clicked!');
    
    const email = document.getElementById('loginEmail').value;
    console.log('📧 Email entered:', email);
    
    if (!email) {
        console.warn('⚠️ No email entered');
        return showToast('Enter email first', 'error');
    }
    
    try {
        console.log('📤 Sending password reset email to:', email);
        await sendPasswordResetEmail(auth, email);
        console.log('✅ Firebase says email sent successfully!');
        showToast('Reset email sent! Check your inbox and spam folder.', 'success');
    } catch (error) {
        console.error('❌ Error sending reset email:', error);
        console.error('Error code:', error.code);
        console.error('Error message:', error.message);
        showToast(error.message, 'error');
    }
});

elements.logoutBtn.addEventListener('click', async () => {
    try {
        await signOut(auth);
        showToast('Logged out', 'success');
        localStorage.removeItem('userName');
        userProfile = { name: '', email: '' };
    } catch (error) {
        showToast(error.message, 'error');
    }
});

// ===== ASSIGNMENTS SEARCH =====
elements.searchAssignments.addEventListener('input', (e) => {
    const searchTerm = e.target.value.toLowerCase();
    if (!assignments) return;
    
    const filtered = assignments.filter(a => 
        a.title.toLowerCase().includes(searchTerm) || 
        (a.subject && a.subject.toLowerCase().includes(searchTerm)) ||
        (a.description && a.description.toLowerCase().includes(searchTerm))
    );
    renderAssignments(filtered);
});

// ===== MODAL FUNCTIONALITY =====
elements.addAssignmentBtn.addEventListener('click', () => {
    elements.addAssignmentModal.classList.add('active');
});

elements.closeModal.addEventListener('click', () => {
    elements.addAssignmentModal.classList.remove('active');
    elements.addAssignmentForm.reset();
});

elements.addAssignmentModal.addEventListener('click', (e) => {
    if (e.target === elements.addAssignmentModal) {
        elements.addAssignmentModal.classList.remove('active');
        elements.addAssignmentForm.reset();
    }
});

elements.addAssignmentForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = document.getElementById('assignmentTitle').value;
    const description = document.getElementById('assignmentDescription').value;
    const dueDate = document.getElementById('assignmentDueDate').value;
    const subject = document.getElementById('assignmentSubject').value;
    
    await addAssignment({ title, description, dueDate, subject });
    elements.addAssignmentModal.classList.remove('active');
    elements.addAssignmentForm.reset();
});

// ===== ASSIGNMENTS CRUD =====
async function addAssignment(data) {
    if (!currentUser) return;
    try {
        showToast('Adding assignment...', 'info');
        await addDoc(collection(db, 'assignments'), {
            ...data,
            userId: currentUser.uid,
            status: 'pending',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });
        showToast('Assignment added!', 'success');
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function toggleAssignmentStatus(id, currentStatus) {
    if (!currentUser) return;
    try {
        const newStatus = currentStatus === 'pending' ? 'completed' : 'pending';
        const assignmentRef = doc(db, 'assignments', id);
        await updateDoc(assignmentRef, {
            status: newStatus,
            updatedAt: serverTimestamp()
        });
        showToast(`Marked as ${newStatus}`, 'success');
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function deleteAssignment(id) {
    if (!currentUser) return;
    if (!confirm('Delete this assignment?')) return;
    try {
        const assignmentRef = doc(db, 'assignments', id);
        await deleteDoc(assignmentRef);
        showToast('Assignment deleted', 'success');
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// ===== NEW: RENDER ASSIGNMENTS WITH EVENT DELEGATION =====
function renderAssignments(assignmentsToRender) {
    const container = elements.assignmentsList;
    
    // Clear container and remove old listeners
    container.innerHTML = '';
    
    if (!assignmentsToRender || assignmentsToRender.length === 0) {
        container.innerHTML = `
            <div class="assignment-card">
                <div class="assignment-title">No assignments yet</div>
                <p class="assignment-meta">Click + to add your first assignment</p>
            </div>
        `;
        return;
    }
    
    // Create document fragment for better performance
    const fragment = document.createDocumentFragment();
    
    assignmentsToRender.forEach(assignment => {
        const dueDate = assignment.dueDate ? new Date(assignment.dueDate).toLocaleDateString() : 'No due date';
        const isOverdue = assignment.dueDate && new Date(assignment.dueDate) < new Date() && assignment.status === 'pending';
        
        // Create card element
        const card = document.createElement('div');
        card.className = 'assignment-card';
        if (isOverdue) card.style.borderLeftColor = '#ef4444';
        
        card.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: start;">
                <div style="flex: 1;">
                    <div class="assignment-title">${assignment.title}</div>
                    <p class="assignment-meta">${assignment.dueDate ? 'Due: ' + dueDate : 'No due date'}</p>
                    ${assignment.subject ? `<p class="assignment-meta">Subject: ${assignment.subject}</p>` : ''}
                </div>
                <div style="display: flex; gap: 8px;">
                    <button class="assignment-action-btn" data-action="toggle" data-id="${assignment.id}" data-status="${assignment.status}" style="background: none; border: none; cursor: pointer; font-size: 18px;" title="Toggle status">
                        ${assignment.status === 'pending' ? '⭕' : '✅'}
                    </button>
                    <button class="assignment-action-btn" data-action="delete" data-id="${assignment.id}" style="background: none; border: none; cursor: pointer; font-size: 18px;" title="Delete">
                        🗑️
                    </button>
                </div>
            </div>
            <span class="assignment-status status-${assignment.status}">${assignment.status === 'pending' ? 'In Progress' : 'Completed'}</span>
            ${isOverdue ? '<p style="color: #ef4444; font-size: 12px; margin-top: 8px;">⚠️ Overdue</p>' : ''}
        `;
        
        fragment.appendChild(card);
    });
    
    container.appendChild(fragment);
}

// ===== NEW: EVENT DELEGATION HANDLER =====
function handleAssignmentAction(e) {
    const button = e.target.closest('.assignment-action-btn');
    if (!button) return;
    
    const action = button.dataset.action;
    const id = button.dataset.id;
    const status = button.dataset.status;
    
    if (action === 'toggle') {
        toggleAssignmentStatus(id, status);
    } else if (action === 'delete') {
        deleteAssignment(id);
    }
}

// Add the event listener to the container (DO THIS ONLY ONCE)
elements.assignmentsList.addEventListener('click', handleAssignmentAction);

// ===== HOME PAGE DATA =====
function updateHomeStats() {
    if (!assignments) return;
    
    const today = new Date().toDateString();
    const active = assignments.filter(a => a.status === 'pending').length;
    const completedToday = assignments.filter(a => {
        if (a.status !== 'completed' || !a.updatedAt) return false;
        const updatedDate = a.updatedAt.toDate ? a.updatedAt.toDate() : new Date(a.updatedAt);
        return updatedDate.toDateString() === today;
    }).length;
    
    animateCounter(elements.activeCount, active);
    animateCounter(elements.completedCount, completedToday);
    animateCounter(elements.totalCount, assignments.length);
}

function animateCounter(element, targetValue) {
    const startValue = parseInt(element.textContent) || 0;
    const duration = 500;
    const startTime = performance.now();
    
    function updateCounter(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const currentValue = Math.floor(startValue + (targetValue - startValue) * progress);
        element.textContent = currentValue;
        if (progress < 1) requestAnimationFrame(updateCounter);
    }
    
    requestAnimationFrame(updateCounter);
}

function loadHomePageData() {
    if (!currentUser || !userProfile) return;
    
    const name = userProfile.name || 'Student';
    elements.homeGreeting.textContent = `Welcome back, ${name}!`;
    
    updateHomeStats();
    
    const recentAssignments = assignments.slice(0, 5);
    const recentList = elements.recentActivityList;
    
    if (recentAssignments.length === 0) {
        recentList.innerHTML = '<p class="assignment-meta">No recent activity. Add your first assignment!</p>';
        return;
    }
    
    recentList.innerHTML = recentAssignments.map(assignment => {
        const dueDate = assignment.dueDate ? new Date(assignment.dueDate).toLocaleDateString() : 'No due date';
        const timeAgo = getTimeAgo(assignment.updatedAt);
        return `
            <div class="activity-item" onclick="navigateTo('assignmentsPage')" style="cursor: pointer;">
                <div>
                    <div class="assignment-title">${assignment.title}</div>
                    <p class="assignment-meta">${dueDate} • ${assignment.subject || 'General'} • ${timeAgo}</p>
                </div>
                <span class="assignment-status status-${assignment.status}">${assignment.status === 'pending' ? 'In Progress' : 'Completed'}</span>
            </div>
        `;
    }).join('');
}

function getTimeAgo(timestamp) {
    if (!timestamp) return 'Just now';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
}

// ===== FETCH FREE MODELS FROM OPENROUTER =====
async function fetchFreeModels() {
    try {
        console.log('📡 Fetching free models from OpenRouter...');
        const response = await fetch('https://openrouter.ai/api/v1/models', {
            headers: {
                'Authorization': `Bearer ${OPENROUTER_KEY}`
            }
        });
        
        if (!response.ok) {
            throw new Error('Failed to fetch models');
        }
        
        const data = await response.json();
        
        // Filter for free models and sort by name
        const freeModels = data.data
            .filter(model => {
                // Check if model is free (pricing is 0 or has "free" in ID)
                const isFree = model.id.includes(':free') || 
                              (model.pricing?.prompt === '0' && model.pricing?.completion === '0');
                return isFree;
            })
            .map(model => ({
                value: model.id,
                name: model.name || model.id,
                contextLength: model.context_length
            }))
            .sort((a, b) => a.name.localeCompare(b.name));
        
        console.log(`✅ Found ${freeModels.length} free models`);
        return freeModels;
        
    } catch (error) {
        console.error('❌ Error fetching models:', error);
        // Fallback to hardcoded list if API fails
        return [
            { value: 'meta-llama/llama-3.2-3b-instruct:free', name: 'Llama 3.2 3B (Fast & Reliable)' },
            { value: 'meta-llama/llama-3.1-8b-instruct:free', name: 'Llama 3.1 8B (Powerful)' },
            { value: 'mistralai/mistral-7b-instruct:free', name: 'Mistral 7B (Balanced)' },
            { value: 'qwen/qwen-2-7b-instruct:free', name: 'Qwen 2 7B (Smart)' },
            { value: 'microsoft/phi-3-mini-128k-instruct:free', name: 'Phi-3 Mini (Compact)' },
            { value: 'google/gemini-2.0-flash-exp:free', name: 'Gemini 2.0 Flash (Google)' }
        ];
    }
}

// ===== BACKGROUND AI INITIALIZATION WITH SYSTEM PROMPT =====
async function initializeAIBackground() {
    if (!currentUser) return;
    
    try {
        console.log('🤖 Initializing AI in background...');
        
        const systemPrompt = `You are a helpful AI assistant integrated into StudyApp, an educational productivity application. 
        
Your role is to:
- Help students with their homework and assignments
- Explain complex concepts in simple terms
- Provide study tips and learning strategies
- Answer questions across various subjects
- Be encouraging and supportive

Keep responses:
- Clear and concise
- Age-appropriate for students
- Educational and informative
- Friendly and encouraging

Current user: ${userProfile.name || 'Student'}
Current date: ${new Date().toLocaleDateString()}`;

        // Send a silent initialization message
        const response = await callOpenRouter(systemPrompt);
        console.log('✅ AI initialized successfully');
        
        // Don't display this message to user, just initialize the connection
        return true;
        
    } catch (error) {
        console.warn('⚠️ AI initialization failed (non-critical):', error.message);
        // This is non-critical, so we don't show error to user
        return false;
    }
}

// ===== PROFILE SETTINGS =====
// This is the updated loadProfileSettings function
// Replace the existing one (lines 518-590) with this

async function loadProfileSettings() {
    if (!currentUser || !userProfile) return;
    
    // Load user's custom API settings from Firestore
    let customApiSettings = {
        enabled: false,
        apiKey: '',
        model: 'meta-llama/llama-3.2-3b-instruct:free'
    };
    
    try {
        const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
        if (userDoc.exists() && userDoc.data().customApiSettings) {
            customApiSettings = { ...customApiSettings, ...userDoc.data().customApiSettings };
        }
    } catch (error) {
        console.error('Error loading API settings:', error);
    }
    
    const settingsContainer = elements.profileSettings;
    const accountCreated = currentUser.metadata.creationTime ? 
        new Date(currentUser.metadata.creationTime).toLocaleDateString() : 'Unknown';
    
    const userMetrics = {
        totalChats: chatHistory.length,
        totalTokens: metrics.totalTokens,
        totalCost: metrics.totalCost,
        totalAssignments: assignments.length
    };
    
    // Fetch available free models from OpenRouter API
    const availableModels = await fetchFreeModels();
    
    settingsContainer.innerHTML = `
        <div class="assignment-card">
            <h4 style="margin-bottom: 12px;">📊 Usage Statistics</h4>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; font-size: 14px;">
                <div>AI Chats: <strong>${userMetrics.totalChats}</strong></div>
                <div>Tokens Used: <strong>${userMetrics.totalTokens}</strong></div>
                <div>Total Cost: <strong>$${userMetrics.totalCost.toFixed(4)}</strong></div>
                <div>Assignments: <strong>${userMetrics.totalAssignments}</strong></div>
            </div>
        </div>
        
        <div class="assignment-card">
            <h4 style="margin-bottom: 12px;">🔧 Preferences</h4>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                <span>Dark Mode</span>
                <label class="switch">
                    <input type="checkbox" id="darkModeToggle">
                    <span class="slider round"></span>
                </label>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                <span>Notifications</span>
                <label class="switch">
                    <input type="checkbox" id="notificationsToggle" checked>
                    <span class="slider round"></span>
                </label>
            </div>
            <p class="assignment-meta">Account created: ${accountCreated}</p>
        </div>
        
        <div class="assignment-card">
            <h4 style="margin-bottom: 12px;">🤖 AI Settings</h4>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                <span>Use Custom OpenRouter API Key</span>
                <label class="switch">
                    <input type="checkbox" id="customApiToggle" ${customApiSettings.enabled ? 'checked' : ''}>
                    <span class="slider round"></span>
                </label>
            </div>
            
            <div id="customApiContainer" style="display: ${customApiSettings.enabled ? 'block' : 'none'}; margin-top: 12px;">
                <div class="form-group" style="margin-bottom: 12px;">
                    <label style="font-size: 14px; margin-bottom: 6px; display: block;">API Key</label>
                    <input 
                        type="password" 
                        id="customApiKeyInput" 
                        placeholder="sk-or-v1-..." 
                        value="${customApiSettings.apiKey}"
                        style="width: 100%; padding: 10px; border: 2px solid var(--border-color); border-radius: 8px; font-size: 14px; background: var(--card-bg); color: var(--text-primary);"
                    >
                    <p style="font-size: 12px; color: var(--text-secondary); margin-top: 4px;">
                        Get your free key at <a href="https://openrouter.ai/keys" target="_blank" style="color: var(--primary-color);">openrouter.ai/keys</a>
                    </p>
                </div>
                
                <div class="form-group">
                    <label style="font-size: 14px; margin-bottom: 6px; display: block;">
                        AI Model 
                        <span style="color: var(--text-secondary); font-weight: normal;">(${availableModels.length} free models available)</span>
                    </label>
                    <select 
                        id="customModelSelect" 
                        style="width: 100%; padding: 10px; border: 2px solid var(--border-color); border-radius: 8px; font-size: 14px; background: var(--card-bg); color: var(--text-primary);"
                    >
                        ${availableModels.map(model => `
                            <option value="${model.value}" ${customApiSettings.model === model.value ? 'selected' : ''}>
                                ${model.name}${model.contextLength ? ` (${model.contextLength.toLocaleString()} tokens)` : ''}
                            </option>
                        `).join('')}
                    </select>
                    <p style="font-size: 12px; color: var(--text-secondary); margin-top: 4px;">
                        💡 All models are free! Updated automatically from OpenRouter.
                    </p>
                </div>
                
                <button class="btn btn-primary" id="saveApiSettingsBtn" style="margin-top: 12px; width: 100%;">
                    Save AI Settings
                </button>
            </div>
        </div>
        
        <div class="assignment-card">
            <h4 style="margin-bottom: 12px;">⚙️ Account Actions</h4>
            <button class="btn btn-secondary" onclick="resetPassword()" style="margin-bottom: 8px;">
                Reset Password
            </button>
            <button class="btn btn-danger" onclick="deleteAccount()">
                Delete Account
            </button>
        </div>
    `;
    
    // Dark mode toggle
    const darkModeToggle = document.getElementById('darkModeToggle');
    const savedDarkMode = localStorage.getItem('darkMode') === 'true';
    if (darkModeToggle) {
        darkModeToggle.checked = savedDarkMode;
        darkModeToggle.addEventListener('change', (e) => {
            if (e.target.checked) {
                document.body.setAttribute('data-theme', 'dark');
            } else {
                document.body.removeAttribute('data-theme');
            }
            localStorage.setItem('darkMode', e.target.checked);
        });
    }
    
    if (savedDarkMode) {
        document.body.setAttribute('data-theme', 'dark');
    }
    
    // Custom API toggle
    const customApiToggle = document.getElementById('customApiToggle');
    const customApiContainer = document.getElementById('customApiContainer');
    
    if (customApiToggle) {
        customApiToggle.addEventListener('change', (e) => {
            customApiContainer.style.display = e.target.checked ? 'block' : 'none';
        });
    }
    
    // Save API settings button
    const saveApiSettingsBtn = document.getElementById('saveApiSettingsBtn');
    if (saveApiSettingsBtn) {
        saveApiSettingsBtn.addEventListener('click', async () => {
            const enabled = document.getElementById('customApiToggle').checked;
            const apiKey = document.getElementById('customApiKeyInput').value.trim();
            const model = document.getElementById('customModelSelect').value;
            
            if (enabled && !apiKey) {
                showToast('Please enter an API key', 'error');
                return;
            }
            
            try {
                showToast('Saving settings...', 'info');
                
                await updateDoc(doc(db, 'users', currentUser.uid), {
                    customApiSettings: {
                        enabled: enabled,
                        apiKey: apiKey,
                        model: model
                    }
                });
                
                showToast('AI settings saved successfully!', 'success');
            } catch (error) {
                console.error('Error saving API settings:', error);
                showToast('Failed to save settings', 'error');
            }
        });
    }
}


async function resetPassword() {
    console.log('🔄 Reset Password button clicked!');
    console.log('👤 Current user:', currentUser);
    
    if (!currentUser) {
        console.error('❌ No user logged in!');
        showToast('Please login first', 'error');
        return;
    }
    
    console.log('📧 Sending reset email to:', currentUser.email);
    
    try {
        await sendPasswordResetEmail(auth, currentUser.email);
        console.log('✅ Firebase says email sent successfully!');
        showToast('Password reset email sent! Check your inbox and spam folder.', 'success');
    } catch (error) {
        console.error('❌ Error sending reset email:', error);
        console.error('Error code:', error.code);
        console.error('Error message:', error.message);
        showToast(error.message, 'error');
    }
}

async function deleteAccount() {
    if (!currentUser) return;
    if (!confirm('Are you sure? This will permanently delete your account and all data.')) return;
    
    try {
        showToast('Deleting account...', 'info');
        const q = query(collection(db, 'assignments'), where('userId', '==', currentUser.uid));
        const snapshot = await getDocs(q);
        const deletePromises = snapshot.docs.map(doc => deleteDoc(doc.ref));
        await Promise.all(deletePromises);
        
        await deleteDoc(doc(db, 'users', currentUser.uid));
        
        showToast('Account deleted', 'success');
        await signOut(auth);
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// ===== CHAT FUNCTIONALITY =====
elements.sendBtn.addEventListener('click', sendMessage);
elements.chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});

async function sendMessage() {
    const message = elements.chatInput.value.trim();
    if (!message) return;
    
    // Input validation
    if (message.length < 2) {
        showToast('Message too short', 'error');
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
    
    // 🔥 NEW: RETRY LOGIC WITH EXPONENTIAL BACKOFF
    let retries = 0;
    const maxRetries = 3;
    
    while (retries < maxRetries) {
        try {
            const response = await callOpenRouterWithFallback(message);
            loadingMsg.remove();
            addMessage(response.content, 'ai');
            updateMetrics(response.metrics);
            saveChatHistory(message, response.content, response.metrics);
            elements.sendBtn.disabled = false;
            return; // Success!
        } catch (error) {
            retries++;
            console.error(`💥 Attempt ${retries}/${maxRetries} failed:`, error);
            
            if (retries < maxRetries) {
                // Wait before retrying (exponential backoff: 1s, 2s, 4s)
                const waitTime = Math.pow(2, retries - 1) * 1000;
                console.log(`⏳ Retrying in ${waitTime}ms...`);
                
                // Update loading message to show retry
                const bubble = loadingMsg.querySelector('.message-bubble');
                if (bubble) {
                    bubble.innerHTML = `<div class="spinner" style="width: 20px; height: 20px; border-width: 2px;"></div> Retry ${retries}/${maxRetries}...`;
                }
                
                await new Promise(resolve => setTimeout(resolve, waitTime));
            } else {
                // All retries exhausted
                loadingMsg.remove();
                const errorMessage = error.message || 'Unknown error';
                addMessage(`❌ Failed after ${maxRetries} attempts: ${errorMessage}`, 'ai');
                showToast(`AI Error: ${errorMessage}`, 'error');
                console.error('🚫 Full error details:', error);
            }
        }
    }
    
    elements.sendBtn.disabled = false;
}

// ===== IMPROVED API CALL WITH BETTER ERROR HANDLING =====
// ===== IMPROVED API CALL WITH BETTER ERROR HANDLING AND CUSTOM SETTINGS =====
async function callOpenRouter(message) {
    const startTime = performance.now();
    
    // Get custom API settings from Firestore if available
    let apiKey = OPENROUTER_KEY;
    let model = AI_MODEL;
    
    if (currentUser) {
        try {
            const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
            if (userDoc.exists() && userDoc.data().customApiSettings) {
                const customSettings = userDoc.data().customApiSettings;
                if (customSettings.enabled && customSettings.apiKey) {
                    apiKey = customSettings.apiKey;
                    model = customSettings.model || AI_MODEL;
                    console.log('Using custom API settings with model:', model);
                }
            }
        } catch (error) {
            console.error('Error loading custom API settings:', error);
            // Fall back to default settings
        }
    }
    
    try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': window.location.origin,
                'X-Title': 'StudyApp'
            },
            body: JSON.stringify({
                model: model,
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

// ===== EXPOSE FUNCTIONS TO WINDOW (for onclick handlers) =====
window.resetPassword = resetPassword;
window.deleteAccount = deleteAccount;

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