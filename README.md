# StudyApp - Mobile Web App Setup

## 1. Firebase Setup
1. Go to console.firebase.google.com
2. Create new project
3. Enable Authentication &gt; Email/Password
4. Copy config to `firebase-config.js`

## 2. OpenRouter Setup
1. Sign up at openrouter.ai
2. Get API key from dashboard
3. Replace `YOUR_OPENROUTER_API_KEY` in main.js
4. Check pricing: https://openrouter.ai/docs#models

## 3. Run & Deploy
```bash
# Local development
python -m http.server 8000

# Deploy to Netlify/Vercel
# Just upload all files