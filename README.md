# 🚀 Kick Viewer Simulator (Educational Project)

This project simulates multiple real viewers on Kick.com by launching browser instances with unique fingerprints and routing them through separate VPN connections. It's built for single-machine usage, with a clean and powerful dashboard that gives you full control over how viewers are created and monitored.

Each viewer behaves like a real user—accepting cookies, adjusting stream quality, and even using a unique IP address thanks to `.ovpn` VPN configs.

⚠️ **This tool is intended for educational and testing purposes only. Use it responsibly and in accordance with Kick's terms of service.**

---

## 📚 Table of Contents
- [✨ Overview](#-overview)
- [🧱 Architecture](#-architecture)
  - [🧠 Backend (Node.js + Puppeteer)](#-backend-nodejs--puppeteer)
  - [🖥️ Frontend (React)](#-frontend-react)
- [🚀 Getting Started](#-getting-started)
- [⚙️ Configuration & Usage](#-configuration--usage)
- [🩺 Troubleshooting](#-troubleshooting)
- [📁 Folder Structure](#-folder-structure)
- [📝 Notes](#-notes)

---

## ✨ Overview

Here's how it works:

- The backend launches Chromium browsers using Puppeteer. Each browser acts like a real Kick viewer.
- Every browser is assigned a unique VPN connection from your `.ovpn` configs to simulate viewers from different regions.
- Viewers are grouped into "Boxes", where:
  - You choose how many browsers each Box contains.
  - You choose how many tabs (viewers) are opened in each browser.
  - Each instance gets a randomized fingerprint, user-agent, and browsing pattern.
- All activity is logged in MongoDB.
- The dashboard lets you upload VPN configs, test them (to verify connection and location), launch viewers, and monitor everything live—including screenshots.

---

## 🧱 Architecture

### 🧠 Backend (Node.js + Puppeteer)
- **Express API:** Manages viewer lifecycle (create, stop, status check).
- **Puppeteer + Chromium:** Automates browser behavior: accepting cookies, adjusting stream settings, etc.
- **MongoDB:** Stores logs, session data, and viewer state.
- **VPN System:**
  - Every viewer connects through its own `.ovpn` config.
  - VPNs are tested before use—location info (country/city) is retrieved and shown.
  - Only verified VPNs are used to ensure each viewer has a valid, unique IP.

### 🖥️ Frontend (React)
- **Dashboard UI:**
  - Live control over viewers.
  - Upload `.ovpn` files directly.
  - Test VPN configs and view the country/city before assigning them.
- **Boxes:**
  - Configure how many browsers and how many tabs per browser.
  - Launch or stop entire boxes at once.
- **Viewer Monitor:**
  - See browser statuses, viewer counts, stream validation, and screenshots.
- Designed for both desktop and mobile.

---

## 🚀 Getting Started

### Requirements
- Node.js v16+
- MongoDB running locally or remotely
- `.ovpn` config files (one per viewer)

### 1. Clone the repo
```bash
git clone https://github.com/CursedScorpio/complete-kick-bots.git

```

### 2. Install dependencies
```bash
cd backend && npm install
cd frontend && npm install
```

### 3. Set up environment variables
Create a `.env` file in the root folder:
```ini
NODE_ENV=development
PORT=5000
HOST=localhost
MONGODB_URI=mongodb://localhost:27017/kick-viewer-simulator
PUPPETEER_HEADLESS=true
LOG_LEVEL=debug
```

### 4. Add VPN configs
- Put your `.ovpn` files in the `vpn/` folder.
- Or upload them through the frontend dashboard.
- Each config must pass a VPN test before being used:
  - This test verifies that the VPN works and retrieves its country and city.

### 5. Start backend
```bash
cd backend
npm run dev
```

### 6. Start frontend
```bash
cd ../frontend
npm start
```

- Backend runs on: [http://localhost:5000](http://localhost:5000)
- Frontend dashboard: [http://localhost:3000](http://localhost:3000)
- If running on a remote server, make sure the correct ports are open.

---

## ⚙️ Configuration & Usage

### Boxes and Tabs
- Create "Boxes" from the dashboard.
- Select how many browsers each Box should run.
- For each browser, set how many tabs to open (each tab is a unique viewer).

### VPN Verification
- All `.ovpn` configs must be tested first.
- The system confirms whether the VPN connects and identifies its geolocation.
- **When running VPN tests, check logs in `backend/temp/` for connection details and errors.**

### Environment Variables
- See `.env.example` for all available settings.

### MongoDB
- Make sure MongoDB is running and accessible from the backend.

---

## 🩺 Troubleshooting

**Backend won't start?**
- Is MongoDB running?
- Are your `.env` variables correct?
- Do you have valid `.ovpn` files in the `vpn/` folder?
- Check `logs/` for detailed errors.

**No viewers launching?**
- Is Puppeteer installed correctly?
- Is Chrome/Chromium available on your system?
- Are VPN configs tested and valid (not already in use)?
- Look at the backend logs for crash info.

**Frontend not loading?**
- Did you install frontend dependencies?
- Is the backend running on port 5000?
- Check browser console for network errors.

---

## 📁 Folder Structure
```
.
├── backend/         # Express + Puppeteer logic
│   ├── config/
│   ├── controllers/
│   ├── models/
│   ├── routes/
│   ├── services/
│   └── utils/
├── frontend/        # React dashboard
├── vpn/             # Your VPN .ovpn configs
├── data/            # Local data storage
├── logs/            # Application logs
└── ...
```

---

## 📝 Notes

This project is purely for educational and testing purposes. Please:
- Use responsibly and ethically.
- Respect Kick.com's terms of service.
- Monitor your CPU, RAM, and bandwidth—each browser/tab will consume resources.
- Avoid abusing.

---