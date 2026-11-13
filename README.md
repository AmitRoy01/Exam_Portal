# Drive MCQ Exam — Public File Link Edition (v1.1)

An MCQ examination web app for online tutoring. Teachers upload PDF/JPG/PNG/WEBP question papers **manually into their own public Google Drive folder** and paste an **individual file's Google Drive Share URL** in the Teacher Dashboard. Students see the original Google Drive preview next to an A/B/C/D answer sheet. The server handles the timer, grading, negative marking, and MongoDB results.

**No Google OAuth, Google API key, or Google Cloud project is required.** This edition does not upload files to Google Drive on your behalf.

## 1. Features

**Teacher:**
- Password-protected Teacher Dashboard (`/admin.html`)
- Create an exam with exam name, number of MCQs (1–200), timer (1–360 minutes)
- Paste a public **file** share link (PDF or image) from Google Drive
- Set correct answer A/B/C/D for every MCQ
- Enable/disable negative marking; set a penalty percentage from 0 to 100
- Generate/copy the shareable student exam URL
- Close/reopen exams and view student results

**Student:**
- See published exams on `/`, click an exam, enter their name (no student registration)
- See Google Drive PDF/image preview on the **left** and MCQ Answer Sheet on the **right** (stacked on narrow screens)
- Select/change A/B/C/D, clear answers, jump to questions, and view the countdown
- Browser refresh restores the attempt on the same device/browser, as long as the attempt token remains in browser localStorage
- Answers autosave; deadline enforced and grading performed **server-side**
- After submission, see mark, correct count, **wrong MCQ numbers**, and skipped MCQ numbers

**MongoDB:**
- `results`: **studentName, examName, mark** plus automatic MongoDB `_id`
- `exams`: exam setup including private answer key
- `attempts`: temporarily stores names/answers/timer to run the exam; **automatically expires about 24 hours after its deadline** (MongoDB TTL cleanup is asynchronous)
- `web_sessions`: teacher login sessions (expire automatically)

## 2. Google Drive — manual upload flow

1. In [Google Drive](https://drive.google.com/drive/my-drive), create/open a folder for exam papers.
2. Set the folder to **General access → Anyone with the link → Viewer**, if you want the folder itself to be public.
3. **Upload your PDF/image manually** into that folder.
4. Right-click the uploaded **file**, then **Share → General access → Anyone with the link → Viewer**. Check the *file's* access setting even if the folder is already public.
5. Click **Copy link** for the **individual file**. Example:

   `https://drive.google.com/file/d/1AbcDefGhijklmnOPQ12345/view?usp=sharing`

6. Test that file link in an **Incognito / Private window** without signing in.
7. Paste the file link into **Create Exam → Google Drive PDF/Image File Link**.

**Important:** Do not paste a folder link such as `https://drive.google.com/drive/folders/...` — the app needs a **file link** to embed the paper. Google Docs/Slides links are not supported by this version; upload actual PDF/image files to Drive.

The app displays the paper using:

```html
<iframe src="https://drive.google.com/file/d/FILE_ID/preview"></iframe>
```

Some browsers, networks, extensions, or Google Workspace sharing policies can prevent embedded previews. Students can use **Open paper in new tab** as a fallback. Google Drive preview controls cannot be completely removed by this application.

## 3. Requirements

- Node.js **20+**
- A MongoDB database (MongoDB Atlas or local MongoDB)
- A Google Drive account for **manual file uploads**
- Internet access to view Google Drive files

## 4. Local setup

1. Extract the ZIP file and open a terminal inside the `drive-mcq-exam-public-link` directory.
2. Install dependencies:

   ```bash
   npm install
   ```

3. Copy `.env.example` to `.env`.
4. Edit `.env`:

   ```env
   PORT=3000
   PUBLIC_URL=http://localhost:3000
   MONGODB_URI=mongodb+srv://USERNAME:PASSWORD@YOUR-CLUSTER.mongodb.net/drive_mcq?retryWrites=true&w=majority
   ADMIN_PASSWORD=your-long-teacher-password
   SESSION_SECRET=your-long-random-secret-at-least-32-characters
   NODE_ENV=development
   ```

5. Run the web app:

   ```bash
   npm start
   ```

6. Open:
   - **Student portal:** http://localhost:3000/
   - **Teacher dashboard:** http://localhost:3000/admin.html
7. Log in as Teacher and create the exam using your public **file** URL.

> `localhost` only works on the machine running the server. To share the exam with students on other devices, deploy the app to a public Node.js hosting service and use the live URL.

## 5. Teacher walkthrough

1. Open `/admin.html` and log in with `ADMIN_PASSWORD`.
2. Enter **Exam Name**, **Number of MCQs**, and **Duration**.
3. Turn on **Negative Marking** if wanted; e.g. `25` means each wrong MCQ subtracts `0.25` marks. Blank/Skipped questions subtract `0`.
4. Paste the **individual Google Drive PDF/image file link**.
5. Select the correct A/B/C/D option for **every question** in Answer Key.
6. Click **Create Exam & Generate Link**.
7. Click **Copy Student Link** beside the created exam. Send the link to students or ask students to open the Student Portal.
8. View **Student Results** on the Teacher Dashboard.

## 6. Student walkthrough

1. Open the student portal, choose the exam, and enter a name.
2. Click **Start Exam**. Countdown starts immediately.
3. Read the original PDF/image in the embedded Google Drive viewer; select A/B/C/D in the answer sheet.
4. Click **Submit Exam**, or let the timer reach zero for automatic grading.
5. See the mark plus the **wrong and skipped question numbers**. Correct options are not disclosed.

## 7. Marking

Each correct MCQ: **+1**. Each wrong MCQ: **−(negative percentage / 100)**. Skipped: **0**.

**Example:** 20 MCQs, 18 correct, 2 wrong, negative marking 25%:

`18 − (2 × 0.25) = 17.50 out of 20`

Scores can be negative if enough answers are wrong and negative marking is enabled.

## 8. MongoDB data example

`results` collection (permanently saved):

```json
{
  "_id": "MongoDB ObjectId",
  "studentName": "Rahim",
  "examName": "Physics Weekly Test",
  "mark": 17.5
}
```

To keep a secure server-side timer, saved answers and the mapping between student and exam, the app **also** uses `attempts` documents temporarily. These are cleaned up via a TTL index about 24 hours after the deadline. A result page may no longer be recoverable from an old attempt token after this cleanup, but the Teacher's score record stays in `results`.

## 9. Deployment

### Netlify (recommended)

The repo is ready for Netlify (`netlify.toml`):

- `public/` is served by Netlify's CDN, with the same security headers helmet sets.
- `/api/*` is rewritten to the `api` Netlify Function (`netlify/functions/api.js`), which runs the Express app.
- `auto-grade` (`netlify/functions/auto-grade.js`) is a **Scheduled Function** that runs every minute and grades expired attempts (replaces the local 30-second timer).
- Login / exam-start rate limits are stored in MongoDB (`rate_limits` collection), so they hold across serverless instances.

Steps:

1. **MongoDB Atlas → Network Access → Add IP Address → `0.0.0.0/0`** (Netlify functions have no fixed IP).
2. Push the code to GitHub/GitLab (**without `.env`**), then in Netlify: **Add new site → Import an existing project** and pick the repo. Build settings come from `netlify.toml` — leave them as they are.
3. **Site configuration → Environment variables** — add (scope: *Functions*, or *All*):
   - `MONGODB_URI`
   - `ADMIN_PASSWORD` — at least 12 characters
   - `SESSION_SECRET` — at least 32 characters, e.g. `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
   - `NODE_ENV=production` (optional — functions default to production)
   - `PUBLIC_URL` — optional; only if you use a custom domain and want share links to always use it. **Do not** copy `PORT` or a `localhost` `PUBLIC_URL`.
4. Deploy (**Deploys → Trigger deploy** after adding variables). Open `https://YOUR-SITE.netlify.app/api/health` — it should return `{"ok":true}`.
5. Log in at `/admin.html`, create a test exam, take it from another device, and confirm the result appears.

Alternatively, with the Netlify CLI: `npm i -g netlify-cli`, `netlify login`, `netlify init` (or `netlify link`), set the variables with `netlify env:set NAME value`, then `netlify deploy --prod`. `netlify dev` runs the Netlify setup locally using `.env`.

> Scheduled Functions only run on the **published production deploy**, not in deploy previews. Students who return to the exam page after the deadline are also graded immediately, so results are never lost.

### Other Node.js hosts

Use a Node.js hosting provider (e.g. Render/Railway/VPS) and MongoDB Atlas:

1. Push the project code to your own private repository, **without `.env`**.
2. Add the values from `.env.example` as environment variables at your hosting provider.
3. Set `PUBLIC_URL=https://YOUR-DOMAIN` and `NODE_ENV=production`.
4. Use a strong `ADMIN_PASSWORD` (at least 12 characters) and a random `SESSION_SECRET` (at least 32 characters).
5. Make sure the site is served over HTTPS, and confirm it can reach MongoDB.
6. Test the student portal from a different device and verify that the uploaded Google Drive file is visible without Google login.

### Run checks

```bash
npm run check
npm test
```

## 10. Important limitations

- Students enter only a name. **Identity is not verified**, and the same person can take the exam more than once by creating another attempt or switching browser/device.
- **Public file sharing:** anyone with the file link can view the question paper. Do not keep the correct answer key, student results, or secrets in the public Drive folder.
- The viewer does **not** parse PDF questions; the teacher sets the answer key by question number, and the student answers by the same numbers.
- The paper cannot be made fully copy-protected once it is public in Drive.
- After the 24-hour attempt cleanup, students cannot restore their old result view using the saved token; the Teacher's `results` collection persists.
- This is a **starter project**, not a third-party audited high-stakes exam platform. Consider student accounts, one-attempt controls, CSRF protection, detailed monitoring, stronger access policies and security review before sensitive large-scale exams.
- Unit tests and JavaScript syntax checks validate the local logic, but a real MongoDB connection, hosted app, and live Google Drive viewer still need end-to-end testing in your environment.

## 11. Project layout

```
server.js                 Express server; exams, attempts, grading, timer, MongoDB
netlify.toml              Netlify build, redirects, headers, schedule
netlify/functions/api.js  Netlify Function wrapping the Express app
netlify/functions/auto-grade.js  Scheduled Function grading expired attempts
logic.js                  Drive file-link validation and scoring
public/admin.html         Teacher Dashboard
public/admin.js           Teacher interactions
public/index.html         Student exam list
public/student.js         Student portal logic
public/exam.html          Student exam page
public/exam.js            PDF viewer + answer sheet + countdown + result
public/styles.css         Responsive styles
.env.example              Config variables, no Google credentials
package.json              Node.js scripts/dependencies
tests/logic.test.js       Unit tests
```
