# פריסה לפרודקשן: Vercel + Railway

## Backend → Railway

### 1. כנסו ל-Railway
```
https://railway.app/login
```

### 2. וודאו שה-.env מכיל את כל הדרוש:
- `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (בדקו ב-dashboard שלכם)
- `RESEND_API_KEY`
- `OPENAI_API_KEY` (אופציונלי)
- `GOOGLE_CLIENT_ID/SECRET` (אופציונלי)
- `WEBHOOK_SECRET`

### 3. בcheckout:
```bash
cd backend
git init
git add .
git commit -m "Initial commit"
git remote add railway <railway-git-url>
git push railway main
```

(Railway יגיד לכם את ה-git URL בעת יצירת project חדש)

### 4. הגדרו Environment Variables ב-Railway Dashboard:
- העתיקו את כל הערכים מ-`.env` שלכם
- הוסיפו: `PORT=3000` (Railway מקצה פורט דינמי)

### 5. Railway יתחיל deploy אוטומטי
הפלט של ה-build יראה משהו כמו:
```
🎷 Zooglot.DB running at https://zooglot-backend-prod.railway.app
```

**שמרו את הכתובת הזו** — תצטרכו אותה בVERCEL.

---

## Frontend → Vercel

### 1. בVERCEL Dashboard — Create New Project
```
https://vercel.com/new
```

### 2. בחרו את frontend ريpository (GitHub)

### 3. בהגדרות Build:
- **Build Command**: אין צורך (Static site)
- **Output Directory**: `.` (root)

### 4. **אתחנו Environment Variable:**
הוסיפו משתנה בTab "Environment Variables":
```
REACT_APP_API_BASE = https://zooglot-backend-prod.railway.app
```
(החליפו את הכתובת עם ה-Railway URL שלכם מסעיף הBackend)

### 5. Vercel יתחיל deploy
הפלט יראה משהו כמו:
```
✓ Deployed to https://zooglot-git-main-itamarn.vercel.app/
```

---

## פרטי המערכת בפרודקשן

| קומפוננטה | כתובת | הערות |
|-----------|-------|------|
| **Frontend** | `https://zooglot-git-main-itamarn.vercel.app` | מעודכנת עם כל push לmain |
| **Backend (API)** | `https://zooglot-backend-prod.railway.app` | מעודכן עם כל push לRailway |
| **Database** | Supabase (כתובת בESUPABASE_URL) | נתונים אמיתיים |
| **Mail** | Resend | אימייל אמיתי |

---

## וולידציה

### 1. בדקו את Backend:
```bash
curl https://zooglot-backend-prod.railway.app/api/health
```
צפוי תגובה:
```json
{"ok":true,"app":"Zooglot.DB","mock_db":false}
```

### 2. בדקו בדפדפן:
```
https://zooglot-git-main-itamarn.vercel.app
```
- התחברות עם פרטי האדמין שיצרתם בRailway

### 3. בדקו קשר API:
בטאב Network → בצעו פעולה בממשק → וודאו שבקשות הן ל-`zooglot-backend-prod.railway.app/api/...`

---

## טיפול בבעיות

### בעיה: Frontend מתקשר לכתובת שגויה
- בדקו ש-`REACT_APP_API_BASE` מוגדר ב-Vercel (Project Settings → Environment Variables)
- וודאו שהערך תקין (בלי `/` בסוף)
- חיזרו לVercel (re-deploy) אחרי כל שינוי

### בעיה: Railway בקר cold start (15 דקות אי-פעילות)
- זה נורמלי בתכנית החינמית
- ההתחברות הראשונה תקח ~30 שניות
- בתכניות בתשלום אין בעיה זו

### בעיה: וואטסאפ לא עובד בRailway
- וואטסאפ דורש חיבור מתמשך
- בRailway זה לא אפשרי בתכנית החינמית (dyno spins down)
- פתרון: העלו גם אתו Fly.io או Heroku שתומכים בחיבור מתמשך

---

## עדכון קוד בעתיד

```bash
# Backend
cd backend
git push railway main

# Frontend
cd frontend
git push origin main  # Vercel יחסן aטומטית
```
