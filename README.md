# Qartix — Campus EV Transit System

A precision, content-free 3D WebGL and transit portal experience built with React and Three.js.

---

## 🎨 Architectural Studio Dark Theme Palette

The entire Qartix application features an **Architectural Slate** studio aesthetic:
- **Base Canvas:** Deep Architectural Slate (`#13161B`) paired with a subtle radial studio spotlight (`radial-gradient(circle at 60% 45%, #242A34 0%, #13161B 70%)`) behind the 3D cart and cards.
- **Three.js Scene & Fog:** Scene background cleared for CSS spotlight pass-through with `THREE.FogExp2(0x13161B, 0.035)` depth fading and a soft circular shadow-catching floor plane beneath the cart.
- **Surfaces & Cards:** Dark Slate (`#1C2128`) elevated surfaces with crisp `1px solid rgba(255, 255, 255, 0.12)` borders and `#0D1013` hard-offset shadows.
- **Typography Contrast:** Crisp off-white (`#F4F5F7`) for headlines and primary metadata; muted cool gray (`#9CA3AF`) for secondary body text.
- **Brand Accents & CTA Palette:** High-energy **Electric Emerald** (`#10B981`, hover `#34D399`) with bold dark ink (`#0B1116`) text and `0 4px 14px rgba(16, 185, 129, 0.25)` glow for all primary CTA buttons, active radio selections, and pills; **Campus Sage** (`#2E6F5E`) verified badges; **Transit Amber** (`#F4C430`) telemetry alerts; and **Signal Vermilion** (`#E85028`) operational transit pick-up state.

---

## 🚦 Application Flow & Architecture

### 1. Initial Entry: `AuthPage.jsx`
The primary landing screen when opening Qartix:
- **Background:** Architectural Slate (`#13161B`) with subtle radial studio spotlight (`radial-gradient(circle at 50% 35%, #242A34 0%, #13161B 75%)`).
- **Clean Centered Single-Column Layout:**
  - **Centered Header:** Minimal Qartix monogram logo + wordmark (`CAMPUS EV TRANSIT`) centered directly above the auth card.
  - **Centered Auth Card:** Crisp `#1C2128` card (`max-w-[460px] mx-auto`) with `1px solid rgba(255, 255, 255, 0.12)` border and `0 16px 36px rgba(0, 0, 0, 0.5)` depth shadow.
  - **Autofill Dark Shield:** CSS `-webkit-autofill` box-shadow overrides keep all email and password fields consistently dark slate without browser white flashes.
- **Inside the Auth Card:**
  1. **Role Selector Tabs:** Clean 2-tab segmented role selector (`Login as Student` and `Login as Driver`). Active tab styled in `#1C2128` on `#13161B` pill track with `#F4F5F7` text.
  2. **Mode Toggle:** Segmented `Log In` vs `Sign Up` controls for students and drivers.
  3. **Dynamic Form Fields:**
     - Inputs styled in `#13161B` with `1px solid rgba(255, 255, 255, 0.15)` borders and `#F4F5F7` text.
     - *Student Login:* University Roll No. / Email and Password.
     - *Student Sign Up:* Full Name, University Roll No. / Email, 2-option **Residency Status** radio button group (`Hostler` vs `Day Scholar`) styled in `#1C2128` with `#10B981` active border and glow, required 10-digit **Mobile Number** (`type="tel"`), and Password.
     - *Driver Login:* Driver ID / Cart Number (e.g. `CART-04`), PIN / Password.
     - *Driver Sign Up:* Driver Full Name, Driver ID / Cart Number, required 10-digit **Mobile Number** (`type="tel"`), and PIN.
  4. **Primary CTA Button:** High-contrast **Electric Emerald** (`#10B981`, hover `#34D399`) with dark ink (`#0B1116`) bold text and `0 4px 14px rgba(16, 185, 129, 0.25)` glow (`Continue as Student →` / `Create Student Account →` / `Continue as Driver →` / `Register Driver Portal →`).
  5. **Quick Demo Fill:** Instant sample credential auto-filler for testing Student (`STU-84920`) and Driver (`CART-04`) roles.
- **Post-Login / Post-Signup Welcome Message:**
  - Sleek top-center auto-dismissing banner (4 seconds, with manual close `×` button) with `#1C2128` background, `#10B981` left accent border, and smooth slide-down entrance animation:
    - *Student Login:* `"Welcome back, [Student Name]! Ready for your campus ride?"`
    - *Student Sign Up:* `"Welcome to Qartix, [Student Name]! Your student account is ready."`
    - *Driver Login / Sign Up:* `"Welcome, Driver [Driver Name / Cart ID]! Have a safe shift."`
- **On Submit:** Authenticates the user in application state and immediately routes to:
  - **Student Interface:** `StudentLanding.jsx` (3D WebGL scroll-driven experience).
  - **Driver Interface:** `DriverInterface.jsx` (Mobile-first industrial instrument panel).

---

### 2. Student Interface: `StudentLanding.jsx` & `StudentDashboard.jsx`

#### A. 3D WebGL Experience (`StudentLanding.jsx`)
Pure 3D WebGL scroll-driven animation experience using Three.js with complete Qartix accessibility content:
- **Top Fixed Navbar:** Qartix logo, Student ID badge (`STU-84920`), high-contrast Electric Emerald (`#10B981`) `Book Pass / Dashboard` CTA, and `#1C2128` `Log Out` button on frosted Dark Slate glass (`rgba(28, 33, 40, 0.88)`).
- **Canvas:** Fixed inset `#13161B` with studio spotlight, cool rim lighting (`#b0d5f8`), and drag-to-orbit support.
- **Procedural 3D Cart (Realistic 6-Seater Kinetic Green Style):** 7 independent `THREE.Group` subsystems:
  - `bodyPanelsGroup`: Aerodynamic sloped front nose/cowl, lower black bumper, curved wheel arches, and recessed LED headlights.
  - `canopyGroup`: Extended molded white fiberglass roof canopy covering all 3 rows, 6 slim black tubular struts, split windshield, and side-view mirrors.
  - `seatingGroup`: 3-row seating (Front forward-facing with steering column & dashboard cup-holder console, Middle forward-facing bench with curved armrests, and Rear-facing bench with flat rear step platform and vertical safety grab bar).
  - `chassisGroup`: Ladder chassis with low flat black ribbed floorboard and brushed silver aluminum side rocker trim.
  - `suspensionGroup`: 4 chunky rounded rubber turf tires with realistic silver 5-spoke alloy rims and hubcaps.
  - `batteryGroup` & `motorGroup`: Internal modular lithium pack and rear electric drive transaxle motor with orange HV cables.
- **4-Stage Scroll Choreography (`01 / 04` Counter):**
  - *Stage 01 (Hero):* Idle hover breathing, 4 paint swatch dots (Ghost Quartz, Obsidian Stealth, Evergreen Campus, Solar Copper) in a `#1C2128` floating palette, fading scroll cue, camera shifted to `x: -0.5` for generous whitespace, and minimal Hero typography sitting directly on Architectural Slate (`max-w-[380px]`):
    - Small Mono Tag: `MONTHLY CAMPUS PASS` (`IBM Plex Mono` with `#2E6F5E` dot)
    - Headline: `Class shouldn't wait for recovery.` (`Bricolage Grotesque`, Bold, `#F4F5F7`)
    - 1-Line Subtext: `Electric cart rides from your hostel or main gate straight to class.` (`DM Sans`, `#9CA3AF`)
    - Single CTA Button: `#10B981` Electric Emerald with bold `#0B1116` text and shadow: `Book Monthly Pass →` (links to Book Pass / Dashboard).
  - *Stage 02 (3-Beat Orbit):*
    - *Beat 01 (Front-3/4 View):* Tag `01 • EASY BOARDING` in `#10B981`, title `Low-Step Entry` in `#F4F5F7`, and copy `Built for crutches, casts, and recovery.` in `#9CA3AF` (`max-w-[320px]`).
    - *Beat 02 (90° Side Profile):* Animated numeric SVG dimension ticks (`180 MM`, `2,150 MM`, `2.8 M`) in `#1C2128` and `#F4F5F7`.
    - *Beat 03 (Rear-3/4 View):* Tag `02 • FIXED TIMINGS`, title `Synced to Classes` in `#F4F5F7`, copy in `#9CA3AF`, and compact dark slate mono pill `HOSTEL / GATE → BLOCK` (`max-w-[320px]`).
  - *Stage 03 (Exploded Assembly):* Outward axis separation of all 7 groups, `[Assembled]` / `[Exploded]` toggle buttons, 5 live projected 3D-to-2D clickable pins (`A`–`E`) with compact 2-word labels (`A: Weather Canopy`, `B: Low-Step Frame`, `C: Recovery Seats`, `D: Crutch Storage`, `E: Electric Drive`), `#10B981` active states, and clean minimal 3-step list in `#F4F5F7` / `#9CA3AF` (`max-w-[320px]`): Title `How It Works`, `01 Verify` — Upload medical slip, `02 Schedule` — Set daily stops, `03 Ride` — Show digital pass.
  - *Stage 04 (X-Ray Cutaway):* Translucent wireframe body panels revealing glowing subsystems with minimal `01`, `02`, `03` focus buttons and clean closing content (`max-w-[340px]`): Tag `04 • CAMPUS FLEET` in `#10B981`, Title `Quiet. Safe. Electric.` in `#F4F5F7`, dynamic 1-line specs (`01`: `All-day battery • Zero emissions`, `02`: `Silent 20 km/h campus motor`, `03`: `Soft suspension for speed bumps`), and final CTA button `#10B981` Electric Emerald `Get Your Monthly Pass →`.

#### B. Monthly Pass Builder & Schedule (`StudentDashboard.jsx`)
Interactive pass booking and daily ride management on Architectural Slate with required medical verification:
- **Interactive Monthly Pass Builder (`#pass-builder-section`):**
  - Split card (`#1C2128` with `1px solid rgba(255, 255, 255, 0.12)` border and `4px 4px 0px #0D1013` offset shadow).
  - *Left (Medical Verification Form):*
    - **Medical Policy Pill:** Highlights that campus monthly mobility passes are reserved for students with injuries, surgery recovery, or mobility limitations.
    - **Medical Condition Dropdown:** Options include `Leg/Ankle Fracture`, `Ligament Tear / Sprain`, `Post-Surgery Recovery`, `Chronic Mobility Condition`, and `Other` (with custom specification input).
    - **Reason for Monthly Pass (Required Textarea):** Detailed explanation of student mobility restrictions.
    - **Medical Certificate Upload (Required):** Drag-and-drop / file selector accepting `.pdf`, `.jpg`, `.png`, and image formats with dynamic preview thumbnail and metadata.
    - **Route Trajectory Template:** Segmented toggle between `Hostel → Class` and `Main Gate → Class`, selectable pickup and drop station dropdowns (`#13161B`).
    - **Daily Scheduled Time Slots:** Pill chips (`08:30 AM`, `10:30 AM`, `01:30 PM`, `04:30 PM`).
    - **Pass Validity Duration:** Selector chips (`2 Weeks`, `1 Month`, `Full Semester`).
    - **Submit for Verification Button:** Electric Emerald (`#10B981`) primary CTA storing the request into shared `localStorage` (`qartix_pass_requests`) and immediately activating the monthly pass.
  - *Right (Live Digital Boarding Pass):*
    - Realistic `#1C2128` ticket card on a `#13161B` backing with cutout semicircle side notches, `IBM Plex Mono` route metadata, and smooth vertical-roll transition upon changes.
    - **Live Status Badge:** Electric Emerald (`#10B981`) badge in the ticket header: `PASS SUBMITTED • TRANSPORT OFFICE NOTIFIED`.
    - **Ink Stamp Slam Animation:** Electric Emerald (`#10B981`) double-border stamp: `PASS SUBMITTED • RECORD FILED` / `TRANSPORT OFFICE NOTIFIED • ACTIVE ACCESS`.
    - **Medical Summary & Attachment:** Displays verified medical condition, student reason snippet, and attached document name/thumbnail.
    - **Perforation & QR Code Stub:** Monospace token and active QR code state (`● TAP OR SCAN AT BOARDING`).
- **Live Ride & Today's Schedule:**
  - *Status Notification Banner:* Displays active mobility pass status (`Monthly Pass Active • Medical Record Notified`) with application metadata (`REQ-XXXX`).
  - *Active Today's Schedule & Live Tracking:*
    - Live Cart #04 tracker with active transit pulse, real-time speed, and approaching station.
    - Today's Scheduled Rides with active `Skip Today` / `Reactivate Ride` toggle and `Request Extra Ride` priority dispatch modal.

---

### 3. Driver Interface: `DriverInterface.jsx`
Modern, driver-friendly EV cockpit aesthetic (inspired by Uber Driver and modern electric vehicle dashboards) with a high-contrast, glare-free dark slate palette optimized for mobile phones, tablets, and desktop/laptop screens:
- **EV Cockpit Palette & Surfaces:**
  - **Base Canvas:** Deep Midnight Slate (`#0B1117`).
  - **Elevated Cards:** Soft Charcoal (`#161F2C`) with subtle `1px solid rgba(255, 255, 255, 0.08)` borders and smooth rounded corners (`rounded-2xl`).
  - **High-Contrast Typography:** Pure White (`#FFFFFF`) for primary headings, routes, and times; Cool Slate (`#94A3B8`) for labels and hints.
  - **Semantic Action Colors:** Electric Emerald (`#10B981`) for Online/Active states, Crisp Sky Blue (`#38BDF8`) for Arrival/Route navigation, and Warm Amber (`#F59E0B`) for ETA alerts.
- **Top Header Bar (Full-Width, Clean):**
  - Left: Cart ID badge (`CART-04`) on the far left with a live pulsing green indicator dot and `CAMPUS EV COCKPIT` label.
  - Right: Right-aligned control group (`ml-auto flex items-center gap-3`) pinning the large thumb-friendly `ONLINE / OFFLINE` pill switch (minimum `48px` tap target) and clean `Log Out` button to the far right corner on all screen sizes without centering drift.
- **Desktop/Laptop Mode (`lg:` and above — 2-Column Dashboard):**
  - **Left Column (`col-span-7`):** Active Ride Hero Card in `#161F2C` featuring:
    - Top Row: ETA pill badge (`PICKUP IN 5 MIN`) on left and scheduled time (`08:45 AM` in bold mono) on right.
    - Visual Vertical 2-Stop Route: Glowing green dot connected by a vertical dashed line to a blue destination pin (`PICKUP` → `Main Gate`, `DROP-OFF` → `Academic Block B`).
    - Student Passenger Strip: Inset dark charcoal row (`#0F172A`) with passenger avatar, name, student ID, hostel/status, and large thumb-friendly `Call Student` button (min `52px` height).
    - **Full-Width Sequential Action Button (`min-h-[64px]`):** High-contrast color-coded state transitions:
      1. `I HAVE ARRIVED` (Crisp Sky Blue `#38BDF8`, dark text `#082F49`)
      2. `STUDENT ON BOARD — START RIDE` (Electric Emerald `#10B981`, dark text `#052E16`)
      3. `COMPLETE RIDE` (Bright Emerald `#34D399`, dark text `#052E16`, checkmark icon)
      - Automatically advances to the next student in the queue upon completion.
  - **Right Column (`col-span-5`):** Live side-by-side **Today's Queue** card showing all upcoming stops, passenger names, times, and clear status badges (`Done`, `Active`, `Waiting`, `Skipped by Student`).
- **Mobile Mode (below `lg:`):**
  - Single-column view with a clean 2-tab pill switcher (`Current Ride` / `Queue (4)`).
  - Sticky bottom Action Button (`min-h-[64px]`) anchored with safe-area spacing.
- **Floating In-Call Toast & Offline Banner:**
  - Active call indicator in `#161F2C` with phone icon, passenger name, and quick `End Call` action.
  - Non-harsh amber offline banner providing clear 1-tap re-activation.

---

## 📁 File Structure

```
Qartix/
├── src/
│   ├── auth/
│   │   └── AuthPage.jsx            # Entry authentication component (Student & Driver)
│   ├── student/
│   │   ├── StudentLanding.jsx      # Pure 3D WebGL Student experience
│   │   └── StudentDashboard.jsx    # Monthly Pass Builder & Today's Schedule
│   ├── driver/
│   │   ├── DriverInterface.jsx     # Mobile-first industrial driver instrument panel
│   │   └── DriverLanding.jsx       # Driver Fleet Console
│   ├── components/
│   │   ├── AuthPage.jsx            # Re-export alias
│   │   ├── StudentLanding.jsx      # Re-export alias
│   │   ├── StudentDashboard.jsx    # Re-export alias
│   │   ├── DriverInterface.jsx     # Re-export alias
│   │   └── DriverLanding.jsx       # Re-export alias
│   ├── App.jsx                     # Root application router (2-role architecture)
│   ├── main.jsx                    # Vite entry
│   └── index.css
├── public/
├── index.html                      # Standard HTML host
├── standalone_preview.html         # Zero-dependency browser preview
├── package.json
├── vite.config.js
└── README.md
```

---

## 🚀 Instant Verification & Testing

Open `standalone_preview.html` in any browser or launch locally:
```bash
python -m http.server 3000
```
Navigate to `http://localhost:3000/standalone_preview.html`.
- Click **⚡ Quick Demo Fill** on the **Student** or **Driver** tab.
- Click the **Electric Emerald (`#10B981`)** button to immediately authenticate, view the smooth slide-down welcome banner, and explore the respective interface.
- As a **Student**, explore the 3D kinetic cart, configure your route in the Monthly Pass Builder, upload medical verification, and see your digital pass activate instantly with `#10B981` badge (`PASS SUBMITTED • TRANSPORT OFFICE NOTIFIED`).
- As a **Driver**, manage live pickups, toggle online/offline in the header, and advance through arrival, boarding, and ride completion.
- Click **Log Out** in the top navigation bar at any time to return to the `AuthPage`.
