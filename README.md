# ClickNGo 

> **Book Local. Live Better.**

ClickNGo is a full-stack local services booking platform that lets users discover and book trusted services near them — from grooming and healthcare to real estate and sports — all in a few taps.

---

##  Project Objective

The goal of ClickNGo is to bridge the gap between local service providers and customers by offering a seamless, category-driven booking experience. Users can browse services by category, view provider availability in real time, and complete secure bookings — all from a single, intuitive web application.

---

##  Screenshots

###  Landing Page
![Landing Page](./ClickNGo-frontend-main/public/images/home.png)

###  User Profile & Bookings Dashboard
![User Profile](./ClickNGo-frontend-main/public/images/profile.png)

###  How It Works & Why Choose Us
![How It Works](./ClickNGo-frontend-main/public/images/whyChooseUs.png)

###  Service Categories
![Service Categories](./ClickNGo-frontend-main/public/images/categories.png)

---

##  Key Features

| Feature | Description |
|---|---|
|  **Service Categories** | Browse Grooming, Real Estate, HealthCare, and Sports & Gaming with sub-categories |
|  **Location-Aware** | City-based service discovery displayed in the navbar |
|  **User Authentication** | Secure sign-up / login with profile management |
|  **Real-Time Booking Calendar** | View live provider availability and lock in a time slot |
|  **Secure Payments** | Integrated payment flow (Razorpay / Stripe ready) |
|  **Instant Notifications** | SMS and email updates at every booking step |
|  **Booking Dashboard** | Track total, completed, cancelled, and pending-review bookings |
|  **Global Search** | Search bar for quick service discovery across all categories |

---

##  Project Structure

```
ClickNGo-Complete/
├── ClickNGo-frontend-main/     # React-based frontend application
│   ├── src/
│   │   ├── components/         # Reusable UI components (Navbar, Cards, etc.)
│   │   ├── pages/              # Route-level pages (Home, Profile, Category, etc.)
│   │   ├── assets/             # Icons, images, and static files
│   │   └── App.jsx             # Root component and routing setup
│   └── package.json
│
├── backend/                    # Node.js/Express backend API
│   ├── routes/                 # API route handlers (auth, bookings, services)
│   ├── controllers/            # Business logic layer
│   ├── models/                 # Database models / schema definitions
│   ├── middleware/             # Auth middleware, error handlers
│   └── index.js                # Server entry point
│
└── .idea/                      # IDE configuration files
```

**Languages used:** JavaScript (92.4%) · PLpgSQL (7.5%) · HTML (0.1%)

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React.js, CSS (custom design system) |
| **Backend** | Node.js, Express.js |
| **Database** | PostgreSQL (with PLpgSQL for stored procedures/queries) |
| **Auth** | JWT-based authentication |
| **Payments** | Razorpay / Stripe (integration-ready) |

---

##  Challenges & Optimizations

### 1.  Connecting Frontend with Backend

**Challenge:** Establishing reliable communication between the React frontend and the Node/Express backend was a major hurdle — especially handling CORS, API base URLs across environments, and synchronizing async state with API responses.

**How I solved it:** Through iterative debugging and learning from each failure, I progressively built a working integration. I studied CORS configuration, set up proper Axios/fetch base URLs, and structured API calls inside React hooks and useEffect blocks. Each error became a learning point that deepened my understanding of how full-stack data flow actually works.

**Optimization applied:**
- Centralized all API calls in a dedicated service layer to keep components clean
- Used environment variables (`.env`) to manage base URLs across development and production
- Added loading and error states in the UI so users always have feedback during API calls

---

### 2.  Designing a Scalable Category Architecture

**Challenge:** Supporting four very different service categories (Grooming, Real Estate, HealthCare, Sports & Gaming), each with their own sub-services and booking flows, without duplicating code.

**Optimization applied:**
- Built a generic, data-driven category page that renders dynamically based on route/category params
- Stored category and sub-category data in a normalized database schema
- Reused shared UI components (cards, grids, modals) across all categories

---

### 3.  Authentication & Session Management

**Challenge:** Implementing secure user authentication while keeping the experience smooth (no unnecessary re-logins, persistent sessions).

**Optimization applied:**
- Used JWT tokens stored securely on the client
- Protected routes on both frontend (React Router guards) and backend (middleware)
- Reflected auth state globally via context so the navbar and profile page stay in sync

---

### 4.  Booking State Tracking

**Challenge:** Accurately tracking booking states (pending, completed, cancelled) and surfacing them to users without stale data.

**Optimization applied:**
- Designed a clear `status` field in the bookings table with PostgreSQL constraints
- Dashboard stats (Total, Completed, Cancelled, Pending Reviews) are computed via efficient SQL queries rather than client-side filtering

---

##  Getting Started

### Prerequisites
- Node.js v22+
- A Supabase project

### Installation

```bash
# Clone the repository
git clone https://github.com/sg-tkg-2004/Click-N-Go.git
cd Click-N-Go

# Setup Backend
cd backend
npm install
# Copy .env.example to .env and set SUPABASE_URL, SUPABASE_SECRET_KEY, and JWT_SECRET
# In Supabase Dashboard > SQL Editor, run the contents of db/schema.sql once
# Then apply supabase/migrations/*.sql in timestamp order, skipping
# 20261006090000_initial_clickngo_schema.sql (it duplicates the base schema)
# Optional: run db/seed_demo.sql afterward to add sample app data
npm run dev

# Setup Frontend (in a new terminal)
cd ../ClickNGo-frontend-main
npm install
npm run dev
```

The backend uses the Supabase Data API with the server-only `SUPABASE_SECRET_KEY`; it does not need a PostgreSQL connection string. Keep the secret key out of the frontend and out of version control.

The optional demo seed creates three `.test` accounts and sample service, booking, payment, review, message, and notification records. Their shared password is `ClickNGoDemo!2026`; the demo admin also needs the `ADMIN_ACCESS_CODE` from `backend/.env`. These are development-only records.

---

<p align="center">Built with by <a href="https://github.com/sg-tkg-2004">Shivam Gupta</a></p>
