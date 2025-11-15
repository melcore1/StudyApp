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
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";
import { firebaseConfig } from './firebase-config.js';

// ===== APP STATE =====
let currentUser = null;
let chatHistory = [];
let metrics = { totalCost: 0, totalTokens: 0, chats: 0 };

// ===== CONFIGURATION =====
const OPENROUTER_KEY = "sk-or-v1-YOUR_OPENROUTER_API_KEY_HERE";
const AI_MODEL = "anthropic/claude-3.5-sonnet";
const MODEL_PRICING = { input: 3.00, output: 15.00 };

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
    toast: document.getElementById('toast')
};

// ===== AUTHENTICATION STATE =====
onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
        showPage('homePage');
        updateProfileInfo();
        loadChatHistory();
        loadAssignments();
    } else {
        currentUser = null;
        showPage('loginPage');
    }
});

// ===== PAGE NAVIGATION =====
function showPage(pageId) {
    document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
    const targetPage = document.getElementById(pageId);
    targetPage.classList.add('active');
    
    const sharedNav = document.getElementById('sharedBottomNav');
    const isAuthPage = targetPage.classList.contains('auth-page');
    sharedNav.style.display = isAuthPage ? 'none' : 'flex';
    
    document.querySelectorAll('#sharedBottomNav .nav-item').forEach(item => {
        item.classList.remove('active');
        if (item.dataset.page === pageId) item.classList.add('active');
    });
    
    if (pageId === 'assignmentsPage') renderAssignments();
    if (pageId === 'homePage') loadHomePageData();
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
        const result = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(result.user, { displayName: name });
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

// ===== ASSIGNMENTS FUNCTIONALITY =====
async function loadAssignments() {
    if (!currentUser) return;
    try {
        const q = query(
            collection(db, 'assignments'),
            where('userId', '==', currentUser.uid),
            orderBy('createdAt', 'desc')
        );
        const snapshot = await getDocs(q);
        const assignments = [];
        snapshot.forEach(doc => {
            assignments.push({ id: doc.id, ...doc.data() });
        });
        renderAssignments(assignments);
        updateHomeStats(assignments);
    } catch (error) {
        showToast('Error loading assignments', 'error');
        console.error(error);
    }
}

function renderAssignments(assignments) {
    const container = elements.assignmentsList;
    if (!assignments || assignments.length === 0) {
        container.innerHTML = `
            <div class="assignment-card">
                <div class="assignment-title">No assignments yet</div>
                <p class="assignment-meta">Click + to add your first assignment</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = assignments.map(assignment => {
        const dueDate = assignment.dueDate ? new Date(assignment.dueDate).toLocaleDateString() : 'No due date';
        const isOverdue = assignment.dueDate && new Date(assignment.dueDate) < new Date() && assignment.status === 'pending';
        return `
            <div class="assignment-card" style="${isOverdue ? 'border-left-color: #ef4444;' : ''}">
                <div style="display: flex; justify-content: space-between; align-items: start;">
                    <div style="flex: 1;">
                        <div class="assignment-title">${assignment.title}</div>
                        <p class="assignment-meta">${dueDate}</p>
                        ${assignment.subject ? `<p class="assignment-meta">Subject: ${assignment.subject}</p>` : ''}
                    </div>
                    <div style="display: flex; gap: 8px;">
                        <button onclick="toggleAssignmentStatus('${assignment.id}', '${assignment.status}')" style="background: none; border: none; cursor: pointer; font-size: 18px;">
                            ${assignment.status === 'pending' ? '⭕' : '✅'}
                        </button>
                        <button onclick="deleteAssignment('${assignment.id}')" style="background: none; border: none; cursor: pointer; font-size: 18px;">
                            🗑️
                        </button>
                    </div>
                </div>
                <span class="assignment-status status-${assignment.status}">${assignment.status === 'pending' ? 'In Progress' : 'Completed'}</span>
                ${isOverdue ? '<p style="color: #ef4444; font-size: 12px; margin-top: 8px;">⚠️ Overdue</p>' : ''}
            </div>
        `;
    }).join('');
}

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
        loadAssignments();
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
        loadAssignments();
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
        loadAssignments();
        showToast('Assignment deleted', 'success');
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// ===== HOME PAGE DATA =====
function updateHomeStats(assignments) {
    if (!assignments) return;
    
    const today = new Date().toDateString();
    const active = assignments.filter(a => a.status === 'pending').length;
    const completedToday = assignments.filter(a => 
        a.status === 'completed' && a.updatedAt && new Date(a.updatedAt.toDate()).toDateString() === today
    ).length;
    
    elements.activeCount.textContent = active;
    elements.completedCount.textContent = completedToday;
    elements.totalCount.textContent = assignments.length;
}

function loadHomePageData() {
    if (!currentUser) return;
    
    const name = localStorage.getItem('userName') || currentUser.displayName || 'Student';
    elements.homeGreeting.textContent = `Welcome back, ${name}!`;
    
    // Load recent activity (last 5 assignments)
    const q = query(
        collection(db, 'assignments'),
        where('userId', '==', currentUser.uid),
        orderBy('updatedAt', 'desc'),
        limit(5)
    );
    
    getDocs(q).then(snapshot => {
        const assignments = [];
        snapshot.forEach(doc => assignments.push({ id: doc.id, ...doc.data() }));
        
        updateHomeStats(assignments);
        
        const recentList = elements.recentActivityList;
        if (assignments.length === 0) {
            recentList.innerHTML = '<p class="assignment-meta">No recent activity</p>';
            return;
        }
        
        recentList.innerHTML = assignments.map(assignment => {
            const dueDate = assignment.dueDate ? new Date(assignment.dueDate).toLocaleDateString() : 'No due date';
            return `
                <div class="activity-item" onclick="navigateTo('assignmentsPage')">
                    <div>
                        <div class="assignment-title">${assignment.title}</div>
                        <p class="assignment-meta">${dueDate} • ${assignment.subject || 'General'}</p>
                    </div>
                    <span class="assignment-status status-${assignment.status}">${assignment.status === 'pending' ? 'In Progress' : 'Completed'}</span>
                </div>
            `;
        }).join('');
    }).catch(error => {
        console.error('Error loading home data', error);
    });
}

// ===== SEARCH FUNCTIONALITY =====
elements.searchAssignments.addEventListener('input', (e) => {
    const searchTerm = e.target.value.toLowerCase();
    const q = query(
        collection(db, 'assignments'),
        where('userId', '==', currentUser.uid),
        orderBy('createdAt', 'desc')
    );
    
    getDocs(q).then(snapshot => {
        const assignments = [];
        snapshot.forEach(doc => assignments.push({ id: doc.id, ...doc.data() }));
        
        const filtered = assignments.filter(a => 
            a.title.toLowerCase().includes(searchTerm) || 
            (a.subject && a.subject.toLowerCase().includes(searchTerm))
        );
        renderAssignments(filtered);
    });
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
    const name = localStorage.getItem('userName') || currentUser.displayName || currentUser.email.split('@')[0];
    elements.profileName.textContent = name;
    elements.profileEmail.textContent = currentUser.email;
    elements.profileAvatar.textContent = name.charAt(0).toUpperCase();
}

// ===== INITIALIZE APP =====
document.addEventListener('DOMContentLoaded', () => {
    const savedMetrics = localStorage.getItem('appMetrics');
    if (savedMetrics) metrics = JSON.parse(savedMetrics);
    
    // Hide nav on auth pages initially
    const sharedNav = document.getElementById('sharedBottomNav');
    sharedNav.style.display = 'none';
});