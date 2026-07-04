# Pragyantra HC_5 - HC_3

A full-stack project with a **TypeScript frontend** and **Python backend**, including automated CI workflows for testing and build verification.

## 🚀 Tech Stack

- **Frontend:** TypeScript (Node.js / npm)
- **Backend:** Python 3.11 (FastAPI + pytest)
- **CI/CD:** GitHub Actions

## 📁 Project Structure

```text
.
├── backend/                 # Python backend service
│   ├── tests/               # Backend test suite
│   └── requirements.txt     # Python dependencies
├── frontend/                # TypeScript frontend app
├── .github/
│   └── workflows/
│       ├── ci.yml           # Main CI workflow
│       └── backend-tests.yml# Backend-path targeted tests
└── README.md
```

## ⚙️ Prerequisites

Make sure you have installed:

- **Python 3.11+**
- **Node.js 18+**
- **npm**
- **Git**

## 🧩 Backend Setup

```bash
cd backend
python -m venv .venv
# Linux/macOS
source .venv/bin/activate
# Windows (PowerShell)
# .venv\Scripts\Activate.ps1

python -m pip install --upgrade pip
pip install -r requirements.txt
```

### Run Backend Tests

From repo root:

```bash
pytest -q backend/tests
```

Or from inside `backend/`:

```bash
pytest tests -q
```

### Run Backend Server (local)

From repo root (example command used in CI style):

```bash
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

## 🎨 Frontend Setup

```bash
cd frontend
npm ci
```

### Run Frontend (development)

```bash
npm run dev
```

### Build Frontend

```bash
npm run build
```

### Preview Production Build (if supported)

```bash
npm run preview
```

> If any script is missing, check `frontend/package.json` and use available scripts.

## 🔐 Environment Variables

Depending on your backend assistant/provider integration, you may need:

- `ASSISTANT_API_KEY`
- `ASSISTANT_PROVIDER` (defaults to `openai` in CI when not set)

Example (`.env` or shell export style):

```env
ASSISTANT_API_KEY=your_api_key_here
ASSISTANT_PROVIDER=openai
```

## ✅ CI Workflows

This repository includes two GitHub Actions workflows:

### 1) `ci.yml` (Main CI)

Runs on push/pull request to `main` and performs:

- Backend dependency install + tests
- Frontend install + build
- Optional assistant smoke test (only when `ASSISTANT_API_KEY` secret is configured)

### 2) `backend-tests.yml` (Path-based backend tests)

Runs only when:

- Files under `backend/**` change, or
- `.github/workflows/backend-tests.yml` changes

Useful for faster backend-only validation.

## 🧪 Assistant Smoke Test (CI)

When secrets are set, CI:

1. Starts backend server on `127.0.0.1:8000`
2. Sends POST request to:
   - `POST /assistant/chat`
3. Prints JSON response for quick verification

## 📌 Common Commands

From repository root:

```bash
# Backend tests
pytest -q backend/tests

# Frontend build
cd frontend && npm ci && npm run build
```

## 🤝 Contributing

1. Create a feature branch
2. Make your changes
3. Run tests/build locally
4. Open a Pull Request to `main`

## 🛠️ Troubleshooting

- **`pytest: command not found`**  
  Activate your virtual environment and reinstall dependencies.
- **Frontend build fails**  
  Run `npm ci` again and confirm Node.js version compatibility.
- **Assistant smoke test skipped in CI**  
  Ensure `ASSISTANT_API_KEY` is added in repository secrets.

## 📄 License

Add your project license here (e.g., MIT) if applicable.
