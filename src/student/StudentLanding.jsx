import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';

/**
 * 4 Curated Automotive Paint Finishes
 */
const PAINT_SWATCHES = [
  { id: 'quartz', name: 'Ghost Quartz', hex: '#E8ECF1', textColor: '#1a1f2c' },
  { id: 'stealth', name: 'Obsidian Stealth', hex: '#1E293B', textColor: '#ffffff' },
  { id: 'evergreen', name: 'Evergreen Campus', hex: '#2D5A46', textColor: '#ffffff' },
  { id: 'copper', name: 'Solar Copper', hex: '#C2673E', textColor: '#ffffff' },
];

/**
 * Stage Metadata for 01-04 Counter
 */
const STAGES = [
  { id: 1, code: '01', label: 'HERO SPEC' },
  { id: 2, code: '02', label: '3-BEAT ORBIT' },
  { id: 3, code: '03', label: 'EXPLODED ASSEMBLY' },
  { id: 4, code: '04', label: 'X-RAY SUBSYSTEMS' },
];

/**
 * 5 Assembly Pins for Stage 03 Live 3D Projection with Qartix Component Labels
 */
const ASSEMBLY_PINS = [
  { id: 'A', groupKey: 'canopyGroup', label: 'Weather Canopy', localPos: new THREE.Vector3(0, 1.72, 0.2) },
  { id: 'B', groupKey: 'bodyPanelsGroup', label: 'Low-Step Frame', localPos: new THREE.Vector3(0.52, 0.55, 0.88) },
  { id: 'C', groupKey: 'seatingGroup', label: 'Recovery Seats', localPos: new THREE.Vector3(-0.28, 0.85, 0.1) },
  { id: 'D', groupKey: 'batteryGroup', label: 'Crutch Storage', localPos: new THREE.Vector3(0, 0.35, 0) },
  { id: 'E', groupKey: 'motorGroup', label: 'Electric Drive', localPos: new THREE.Vector3(0, 0.35, -1.075) },
];

/**
 * StudentLanding Component
 * 3D WebGL scroll-driven experience using Three.js with full Qartix accessibility content.
 */
export default function StudentLanding({
  onBookPass = () => {},
  onLogout = () => {},
  studentId = 'STU-84920',
  student = null,
}) {
  // UI States
  const [activeSwatch, setActiveSwatch] = useState(PAINT_SWATCHES[0].hex);
  const [activeStageIndex, setActiveStageIndex] = useState(0); // 0, 1, 2, 3
  const [scrollProgressDisplay, setScrollProgressDisplay] = useState(0);
  const [stage2Beat, setStage2Beat] = useState(0); // 0: tight, 1: 90 side, 2: rear

  // Stage 03 Controls
  const [explosionOverride, setExplosionOverride] = useState(null); // null, 0 (assembled), 1 (exploded)
  const [isolatedPin, setIsolatedPin] = useState(null);
  const [pinScreenCoords, setPinScreenCoords] = useState({});

  // Stage 04 Controls
  const [activeSubsystem, setActiveSubsystem] = useState('ALL');

  // DOM Mount Ref
  const mountRef = useRef(null);
  const scrollContainerRef = useRef(null);

  // High Performance Mutable Refs for 60/120fps Animation Loop (Zero Re-Mounts)
  const scrollProgressRef = useRef(0);
  const activeSwatchRef = useRef(PAINT_SWATCHES[0].hex);
  const explosionOverrideRef = useRef(null);
  const isolatedPinRef = useRef(null);
  const activeSubsystemRef = useRef('ALL');

  // Three.js Scene References
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const rendererRef = useRef(null);
  const cartMasterGroupRef = useRef(null);
  const groupsRef = useRef({});
  const suspensionCornersRef = useRef([]);
  const mainPaintMaterialsRef = useRef([]);
  const bodyMaterialsRef = useRef([]);
  const canopyMaterialsRef = useRef([]);
  const batteryMaterialsRef = useRef([]);
  const motorMaterialsRef = useRef([]);
  const suspensionMaterialsRef = useRef([]);

  // Drag-to-Orbit Interaction Refs
  const isDraggingRef = useRef(false);
  const pointerStartRef = useRef({ x: 0, y: 0 });
  const orbitOffsetRef = useRef({ yaw: 0, pitch: 0 });
  const targetOrbitOffsetRef = useRef({ yaw: 0, pitch: 0 });
  const currentCameraLookAtRef = useRef(new THREE.Vector3(-0.5, 0.55, 0));
  const currentExplosionRef = useRef(0);

  // Keep Mutable Refs Synchronized with React State
  activeSwatchRef.current = activeSwatch;
  explosionOverrideRef.current = explosionOverride;
  isolatedPinRef.current = isolatedPin;
  activeSubsystemRef.current = activeSubsystem;

  // -------------------------------------------------------------
  // REAL-TIME SWATCH SELECTION HANDLER
  // -------------------------------------------------------------
  const handleSelectSwatch = (hex) => {
    setActiveSwatch(hex);
    activeSwatchRef.current = hex;
    mainPaintMaterialsRef.current.forEach((mat) => {
      if (mat && mat.color) mat.color.set(hex);
    });
  };

  // -------------------------------------------------------------
  // REAL-TIME PIN ISOLATION HANDLER (STAGE 03)
  // -------------------------------------------------------------
  const handleTogglePin = (pinId) => {
    const nextPin = isolatedPin === pinId ? null : pinId;
    setIsolatedPin(nextPin);
    isolatedPinRef.current = nextPin;

    const groups = groupsRef.current;
    if (!groups.chassisGroup) return;

    if (!nextPin) {
      // Restore normal full opacity across all 7 groups
      Object.values(groups).forEach((group) => {
        if (!group) return;
        group.traverse((obj) => {
          if (obj.isMesh && obj.material) {
            obj.material.transparent = false;
            obj.material.opacity = 1.0;
          }
        });
      });
      return;
    }

    const targetPin = ASSEMBLY_PINS.find((p) => p.id === nextPin);
    if (!targetPin) return;

    Object.entries(groups).forEach(([key, group]) => {
      if (!group) return;
      const isTarget = key === targetPin.groupKey;
      group.traverse((obj) => {
        if (obj.isMesh && obj.material) {
          obj.material.transparent = true;
          obj.material.opacity = isTarget ? 1.0 : 0.15;
        }
      });
    });
  };

  // -------------------------------------------------------------
  // BUILD PROCEDURAL 3D ELECTRIC CAMPUS CART (7 GROUPS)
  // -------------------------------------------------------------
  const buildProceduralCart = useCallback(() => {
    const master = new THREE.Group();
    master.name = 'cartMasterGroup';

    const chassisGroup = new THREE.Group();
    chassisGroup.name = 'chassisGroup';

    const bodyPanelsGroup = new THREE.Group();
    bodyPanelsGroup.name = 'bodyPanelsGroup';

    const canopyGroup = new THREE.Group();
    canopyGroup.name = 'canopyGroup';

    const seatingGroup = new THREE.Group();
    seatingGroup.name = 'seatingGroup';

    const batteryGroup = new THREE.Group();
    batteryGroup.name = 'batteryGroup';

    const motorGroup = new THREE.Group();
    motorGroup.name = 'motorGroup';

    const suspensionGroup = new THREE.Group();
    suspensionGroup.name = 'suspensionGroup';

    const mainPaintMats = [];
    const bodyMats = [];
    const canopyMats = [];
    const batteryMats = [];
    const motorMats = [];
    const suspMats = [];
    const suspCorners = [];

    // =========================================================
    // 1. MATERIAL PALETTE (Realistic Kinetic Green EV Shuttles)
    // =========================================================
    // Dark steel chassis
    const darkChassisMat = new THREE.MeshStandardMaterial({
      color: 0x1a1d21,
      metalness: 0.8,
      roughness: 0.4,
    });

    // Automotive high-gloss paint finish (responds to 4 swatches)
    const glossBodyMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(activeSwatchRef.current),
      metalness: 0.25,
      roughness: 0.2,
    });
    mainPaintMats.push(glossBodyMat);
    bodyMats.push(glossBodyMat);

    // Dark satin body trim & wheel arches
    const darkTrimMat = new THREE.MeshStandardMaterial({
      color: 0x15181c,
      roughness: 0.55,
      metalness: 0.25,
    });
    bodyMats.push(darkTrimMat);

    // Textured black rubber floorboard
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x16181b,
      roughness: 0.85,
      metalness: 0.05,
    });

    // Brushed silver aluminum side rocker trim
    const rockerTrimMat = new THREE.MeshStandardMaterial({
      color: 0xd8dde4,
      metalness: 0.9,
      roughness: 0.2,
    });

    // Recessed LED projector headlights
    const headlightMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xc8e6ff,
      emissiveIntensity: 2.8,
      metalness: 0.1,
      roughness: 0.1,
    });
    bodyMats.push(headlightMat);

    // Ruby rear LED taillights
    const taillightMat = new THREE.MeshStandardMaterial({
      color: 0xff2233,
      emissive: 0xff1122,
      emissiveIntensity: 3.2,
      metalness: 0.2,
      roughness: 0.2,
    });
    bodyMats.push(taillightMat);

    // Molded white fiberglass roof canopy
    const canopyFiberglassMat = new THREE.MeshStandardMaterial({
      color: 0xf3f5f8,
      metalness: 0.1,
      roughness: 0.35,
    });
    canopyMats.push(canopyFiberglassMat);

    // Transparent split windshield glass
    const windshieldMat = new THREE.MeshPhysicalMaterial({
      color: 0xc8ddf0,
      metalness: 0.1,
      roughness: 0.05,
      transmission: 0.88,
      transparent: true,
      opacity: 0.4,
    });
    canopyMats.push(windshieldMat);

    // Reflective side-view mirror face
    const mirrorFaceMat = new THREE.MeshStandardMaterial({
      color: 0xf0f4f8,
      metalness: 0.95,
      roughness: 0.05,
    });

    // Black cushioned leatherette bench upholstery
    const cushionMat = new THREE.MeshStandardMaterial({
      color: 0x1e2229,
      roughness: 0.8,
      metalness: 0.08,
    });

    // Molded under-seat pedestal bases
    const seatBaseMat = new THREE.MeshStandardMaterial({
      color: 0x242831,
      roughness: 0.45,
      metalness: 0.25,
    });
    bodyMats.push(seatBaseMat);

    // Internal lithium battery tray & cells (X-ray pulsing)
    const batteryTrayMat = new THREE.MeshStandardMaterial({
      color: 0x181e26,
      metalness: 0.85,
      roughness: 0.3,
    });
    batteryMats.push(batteryTrayMat);

    const batteryCellMat = new THREE.MeshStandardMaterial({
      color: 0x00d2ff,
      emissive: 0x00a8e8,
      emissiveIntensity: 0.6,
      metalness: 0.4,
      roughness: 0.25,
    });
    batteryMats.push(batteryCellMat);

    const busbarMat = new THREE.MeshStandardMaterial({
      color: 0x00f0ff,
      emissive: 0x00d8f6,
      emissiveIntensity: 1.4,
      metalness: 0.9,
      roughness: 0.1,
    });
    batteryMats.push(busbarMat);

    // Electric motor housing & high-voltage cables
    const motorHousingMat = new THREE.MeshStandardMaterial({
      color: 0x282f37,
      metalness: 0.9,
      roughness: 0.25,
    });
    motorMats.push(motorHousingMat);

    const orangeHvCableMat = new THREE.MeshStandardMaterial({
      color: 0xff5500,
      emissive: 0xff3b00,
      emissiveIntensity: 0.4,
      roughness: 0.45,
      metalness: 0.1,
    });
    motorMats.push(orangeHvCableMat);

    // Suspension alloy, coil springs, chunky rubber tires & alloy rims
    const suspensionAlloyMat = new THREE.MeshStandardMaterial({
      color: 0x8a929e,
      metalness: 0.9,
      roughness: 0.2,
    });
    suspMats.push(suspensionAlloyMat);

    const coilSpringMat = new THREE.MeshStandardMaterial({
      color: 0xd9e2ec,
      emissive: 0x336699,
      emissiveIntensity: 0.2,
      metalness: 0.95,
      roughness: 0.15,
    });
    suspMats.push(coilSpringMat);

    const tireRubberMat = new THREE.MeshStandardMaterial({
      color: 0x161719,
      roughness: 0.88,
      metalness: 0.02,
    });
    suspMats.push(tireRubberMat);

    const wheelAlloyMat = new THREE.MeshStandardMaterial({
      color: 0xdde3ea,
      metalness: 0.88,
      roughness: 0.2,
    });
    suspMats.push(wheelAlloyMat);

    const brakeCaliperMat = new THREE.MeshStandardMaterial({
      color: 0x00c8ff,
      emissive: 0x0099cc,
      emissiveIntensity: 0.3,
      metalness: 0.7,
      roughness: 0.3,
    });
    suspMats.push(brakeCaliperMat);

    // =========================================================
    // 2. CHASSIS GROUP (Low Flat Floorboard & Silver Rocker Trim)
    // =========================================================
    // Longitudinal steel box rails
    const leftRail = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 2.9), darkChassisMat);
    leftRail.position.set(-0.42, 0.2, 0);
    const rightRail = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 2.9), darkChassisMat);
    rightRail.position.set(0.42, 0.2, 0);
    chassisGroup.add(leftRail, rightRail);

    // Transverse chassis cross-members
    [-1.3, -0.65, 0.0, 0.65, 1.3].forEach((cz) => {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.07, 0.07), darkChassisMat);
      beam.position.set(0, 0.2, cz);
      chassisGroup.add(beam);
    });

    // Low flat black ribbed floorboard
    const floorDeck = new THREE.Mesh(new THREE.BoxGeometry(1.06, 0.028, 2.35), floorMat);
    floorDeck.position.set(0, 0.24, 0.12);
    chassisGroup.add(floorDeck);

    // Ribbed floor treads (anti-slip rubber strips)
    [-0.36, -0.24, -0.12, 0, 0.12, 0.24, 0.36].forEach((rx) => {
      const rib = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.008, 2.3), darkTrimMat);
      rib.position.set(rx, 0.258, 0.12);
      chassisGroup.add(rib);
    });

    // Brushed silver aluminum side rocker trim (between front & rear wheel wells)
    const leftRocker = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.045, 1.85), rockerTrimMat);
    leftRocker.position.set(-0.54, 0.23, 0.08);
    const rightRocker = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.045, 1.85), rockerTrimMat);
    rightRocker.position.set(0.54, 0.23, 0.08);
    chassisGroup.add(leftRocker, rightRocker);

    // =========================================================
    // 3. BODY PANELS GROUP (Aerodynamic Cowl, LED Lights, Bumper)
    // =========================================================
    // Smooth aerodynamic front cowl / hood
    const frontCowl = new THREE.Mesh(new THREE.BoxGeometry(1.08, 0.18, 0.85), glossBodyMat);
    frontCowl.position.set(0, 0.49, 1.05);
    frontCowl.rotation.x = 0.18; // sleek sloped angle
    bodyPanelsGroup.add(frontCowl);

    // Curved front nose facet
    const frontNose = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.22, 0.32), glossBodyMat);
    frontNose.position.set(0, 0.36, 1.4);
    frontNose.rotation.x = 0.36;
    bodyPanelsGroup.add(frontNose);

    // Lower front grille intake
    const frontGrille = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.1, 0.02), darkTrimMat);
    frontGrille.position.set(0, 0.26, 1.54);
    bodyPanelsGroup.add(frontGrille);

    // Heavy-duty lower black front bumper
    const frontBumper = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.1, 0.14), darkTrimMat);
    frontBumper.position.set(0, 0.25, 1.58);
    const leftBumperGuard = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.18), darkTrimMat);
    leftBumperGuard.position.set(-0.56, 0.26, 1.52);
    const rightBumperGuard = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.18), darkTrimMat);
    rightBumperGuard.position.set(0.56, 0.26, 1.52);
    bodyPanelsGroup.add(frontBumper, leftBumperGuard, rightBumperGuard);

    // 2 Clean recessed LED headlights on sloped front corners
    const leftHeadlight = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.06, 0.08), headlightMat);
    leftHeadlight.position.set(-0.4, 0.46, 1.42);
    leftHeadlight.rotation.x = 0.22;
    leftHeadlight.rotation.y = 0.12;
    const rightHeadlight = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.06, 0.08), headlightMat);
    rightHeadlight.position.set(0.4, 0.46, 1.42);
    rightHeadlight.rotation.x = 0.22;
    rightHeadlight.rotation.y = -0.12;
    bodyPanelsGroup.add(leftHeadlight, rightHeadlight);

    // Curved front wheel arches & fenders
    const leftFrontFender = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 0.65), darkTrimMat);
    leftFrontFender.position.set(-0.54, 0.43, 1.075);
    const rightFrontFender = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 0.65), darkTrimMat);
    rightFrontFender.position.set(0.54, 0.43, 1.075);
    bodyPanelsGroup.add(leftFrontFender, rightFrontFender);

    // Rear wheel arches & rear body panels
    const leftRearFender = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 0.65), darkTrimMat);
    leftRearFender.position.set(-0.54, 0.43, -1.075);
    const rightRearFender = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 0.65), darkTrimMat);
    rightRearFender.position.set(0.54, 0.43, -1.075);
    const rearFascia = new THREE.Mesh(new THREE.BoxGeometry(1.08, 0.22, 0.2), glossBodyMat);
    rearFascia.position.set(0, 0.36, -1.28);
    bodyPanelsGroup.add(leftRearFender, rightRearFender, rearFascia);

    // Rear LED taillights
    const leftTaillight = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.04, 0.03), taillightMat);
    leftTaillight.position.set(-0.44, 0.45, -1.37);
    const rightTaillight = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.04, 0.03), taillightMat);
    rightTaillight.position.set(0.44, 0.45, -1.37);
    bodyPanelsGroup.add(leftTaillight, rightTaillight);

    // =========================================================
    // 4. CANOPY GROUP (Extended Molded Roof, Split Windshield, Mirrors)
    // =========================================================
    // Long molded white fiberglass roof canopy extending over ALL 3 rows
    const roofMain = new THREE.Mesh(new THREE.BoxGeometry(1.16, 0.045, 2.92), canopyFiberglassMat);
    roofMain.position.set(0, 1.66, -0.12);
    const roofCrown = new THREE.Mesh(new THREE.BoxGeometry(0.88, 0.025, 2.75), canopyFiberglassMat);
    roofCrown.position.set(0, 1.685, -0.12);
    const roofTrimRim = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.02, 2.94), darkTrimMat);
    roofTrimRim.position.set(0, 1.64, -0.12);
    canopyGroup.add(roofMain, roofCrown, roofTrimRim);

    // Subtle underside cross-ribs
    [0.85, 0.2, -0.45, -1.1].forEach((rz) => {
      const rib = new THREE.Mesh(new THREE.BoxGeometry(1.08, 0.025, 0.04), darkTrimMat);
      rib.position.set(0, 1.625, rz);
      canopyGroup.add(rib);
    });

    // Slim black tubular roof struts (6-pillar support)
    // Front A-pillars (sloped)
    const leftAPillar = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1.12, 12), darkTrimMat);
    leftAPillar.position.set(-0.48, 1.12, 0.66);
    leftAPillar.rotation.x = -0.22;
    const rightAPillar = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1.12, 12), darkTrimMat);
    rightAPillar.position.set(0.48, 1.12, 0.66);
    rightAPillar.rotation.x = -0.22;
    // Middle B-pillars (vertical)
    const leftBPillar = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1.25, 12), darkTrimMat);
    leftBPillar.position.set(-0.5, 1.05, -0.05);
    const rightBPillar = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1.25, 12), darkTrimMat);
    rightBPillar.position.set(0.5, 1.05, -0.05);
    // Rear C-pillars (vertical)
    const leftCPillar = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1.25, 12), darkTrimMat);
    leftCPillar.position.set(-0.5, 1.05, -0.92);
    const rightCPillar = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1.25, 12), darkTrimMat);
    rightCPillar.position.set(0.5, 1.05, -0.92);
    canopyGroup.add(leftAPillar, rightAPillar, leftBPillar, rightBPillar, leftCPillar, rightCPillar);

    // Clear slightly angled split windshield with black frame clamps
    const windshieldUpper = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.38, 0.012), windshieldMat);
    windshieldUpper.position.set(0, 1.28, 0.63);
    windshieldUpper.rotation.x = -0.22;
    const windshieldLower = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.42, 0.012), windshieldMat);
    windshieldLower.position.set(0, 0.9, 0.72);
    windshieldLower.rotation.x = -0.22;
    const windshieldHingeClamp = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.025, 0.025), darkTrimMat);
    windshieldHingeClamp.position.set(0, 1.09, 0.675);
    windshieldHingeClamp.rotation.x = -0.22;
    canopyGroup.add(windshieldUpper, windshieldLower, windshieldHingeClamp);

    // 2 Compact side-view mirrors
    [-0.58, 0.58].forEach((mx) => {
      const mirrorSub = new THREE.Group();
      const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.1, 8), darkTrimMat);
      stalk.rotation.z = mx < 0 ? -Math.PI / 3 : Math.PI / 3;
      stalk.position.set(mx < 0 ? 0.04 : -0.04, 0, 0);
      const housing = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.12, 0.08), darkTrimMat);
      const glass = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.11, 0.07), mirrorFaceMat);
      glass.position.set(mx < 0 ? 0.01 : -0.01, 0, -0.005);
      mirrorSub.add(stalk, housing, glass);
      mirrorSub.position.set(mx, 1.08, 0.65);
      canopyGroup.add(mirrorSub);
    });

    // =========================================================
    // 5. SEATING GROUP (3 Rows, Rear Step & Grab Bar, Console)
    // =========================================================
    // Helper to build a contoured cushioned bench seat
    const createBenchRow = (zBase, isRearFacing = false) => {
      const rowGroup = new THREE.Group();

      // Molded under-seat base
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.2, 0.44), seatBaseMat);
      base.position.set(0, 0.34, 0);

      // Cushioned bench seat
      const cushion = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.12, 0.44), cushionMat);
      cushion.position.set(0, 0.48, 0);

      // Contoured backrest bench
      const backrestZ = isRearFacing ? 0.18 : -0.2;
      const backrestRotX = isRearFacing ? 0.1 : -0.1;
      const backrest = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.28, 0.08), cushionMat);
      backrest.position.set(0, 0.74, backrestZ);
      backrest.rotation.x = backrestRotX;

      // Curved black tubular armrests / hip restraints
      const leftArm = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.14, 0.4), darkTrimMat);
      leftArm.position.set(-0.5, 0.55, 0);
      const rightArm = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.14, 0.4), darkTrimMat);
      rightArm.position.set(0.5, 0.55, 0);

      rowGroup.add(base, cushion, backrest, leftArm, rightArm);
      rowGroup.position.set(0, 0, zBase);
      return rowGroup;
    };

    // Row 1 (Front Forward-Facing)
    seatingGroup.add(createBenchRow(0.35, false));

    // Row 2 (Middle Forward-Facing)
    seatingGroup.add(createBenchRow(-0.28, false));

    // Row 3 (Rear-Facing Bench Seat at the Back)
    seatingGroup.add(createBenchRow(-0.8, true));

    // Row 1 Dashboard Console, Cup-holders & Steering Wheel
    const dashConsole = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.18, 0.24), darkTrimMat);
    dashConsole.position.set(0, 0.62, 0.68);
    // 2 Cup-holders on passenger side
    const cup1 = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.06, 16), darkChassisMat);
    cup1.position.set(0.24, 0.69, 0.68);
    const cup2 = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.06, 16), darkChassisMat);
    cup2.position.set(0.36, 0.69, 0.68);
    // Center state-of-charge LCD cluster
    const clusterGlowMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      emissive: 0x38bdf8,
      emissiveIntensity: 0.9,
    });
    const cluster = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.08, 0.02), clusterGlowMat);
    cluster.position.set(0, 0.68, 0.64);
    cluster.rotation.x = -0.35;
    // Angled steering column & wheel
    const steeringColumn = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.48, 12), darkTrimMat);
    steeringColumn.position.set(-0.26, 0.58, 0.58);
    steeringColumn.rotation.x = -0.55;
    const steeringWheelRim = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.016, 12, 28), darkTrimMat);
    steeringWheelRim.position.set(-0.26, 0.74, 0.47);
    steeringWheelRim.rotation.x = -0.55;
    const steeringHub = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.03, 16), darkTrimMat);
    steeringHub.position.set(-0.26, 0.74, 0.47);
    steeringHub.rotation.x = -0.55;
    seatingGroup.add(dashConsole, cup1, cup2, cluster, steeringColumn, steeringWheelRim, steeringHub);

    // Floor Pedals
    const brakePedal = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.03), darkTrimMat);
    brakePedal.position.set(-0.2, 0.27, 0.76);
    const accelPedal = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.1, 0.03), darkTrimMat);
    accelPedal.position.set(-0.08, 0.27, 0.76);
    seatingGroup.add(brakePedal, accelPedal);

    // Rear Footrest / Step Platform (extends behind rear bumper for Row 3)
    const rearStepPlatform = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.035, 0.36), floorMat);
    rearStepPlatform.position.set(0, 0.23, -1.38);
    // Anti-slip step treads
    [-0.35, -0.15, 0.05, 0.25].forEach((tx) => {
      const stepRib = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.008, 0.32), darkTrimMat);
      stepRib.position.set(tx, 0.252, -1.38);
      seatingGroup.add(stepRib);
    });
    // Vertical black rear U-shaped grab bar
    const leftGrabUpright = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.82, 12), darkTrimMat);
    leftGrabUpright.position.set(-0.22, 0.64, -1.5);
    const rightGrabUpright = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.82, 12), darkTrimMat);
    rightGrabUpright.position.set(0.22, 0.64, -1.5);
    const topGrabBar = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.032, 0.032), darkTrimMat);
    topGrabBar.position.set(0, 1.05, -1.5);
    seatingGroup.add(rearStepPlatform, leftGrabUpright, rightGrabUpright, topGrabBar);

    // =========================================================
    // 6. BATTERY GROUP (Under-Floor Modular Lithium Pack)
    // =========================================================
    const batteryTray = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.14, 1.85), batteryTrayMat);
    batteryTray.position.set(0, 0.12, 0);
    batteryGroup.add(batteryTray);

    [
      [-0.23, 0.14, -0.65],
      [0.23, 0.14, -0.65],
      [-0.23, 0.14, -0.22],
      [0.23, 0.14, -0.22],
      [-0.23, 0.14, 0.22],
      [0.23, 0.14, 0.22],
      [-0.23, 0.14, 0.65],
      [0.23, 0.14, 0.65],
    ].forEach(([cx, cy, cz]) => {
      const cell = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.09, 0.36), batteryCellMat);
      cell.position.set(cx, cy, cz);
      batteryGroup.add(cell);
    });

    const busbar = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.05, 1.7), busbarMat);
    busbar.position.set(0, 0.17, 0);
    batteryGroup.add(busbar);

    // =========================================================
    // 7. MOTOR GROUP (Rear Electric Transaxle Drive & Cables)
    // =========================================================
    const rearMotor = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.46, 24), motorHousingMat);
    rearMotor.rotateZ(Math.PI / 2);
    rearMotor.position.set(0, 0.26, -1.075);
    motorGroup.add(rearMotor);

    [-0.15, -0.05, 0.05, 0.15].forEach((xOff) => {
      const rib = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.02, 24), suspensionAlloyMat);
      rib.rotateZ(Math.PI / 2);
      rib.position.set(xOff, 0.26, -1.075);
      motorGroup.add(rib);
    });

    const inverter = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.14, 0.28), motorHousingMat);
    inverter.position.set(0, 0.42, -1.075);
    const frontSteeringMotor = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.36, 20), motorHousingMat);
    frontSteeringMotor.rotateZ(Math.PI / 2);
    frontSteeringMotor.position.set(0, 0.26, 1.075);
    motorGroup.add(inverter, frontSteeringMotor);

    const createHvCable = (pts) => {
      const curve = new THREE.CatmullRomCurve3(pts);
      const tubeGeo = new THREE.TubeGeometry(curve, 20, 0.022, 10, false);
      return new THREE.Mesh(tubeGeo, orangeHvCableMat);
    };

    motorGroup.add(
      createHvCable([
        new THREE.Vector3(-0.1, 0.16, -0.85),
        new THREE.Vector3(-0.15, 0.28, -0.98),
        new THREE.Vector3(-0.1, 0.38, -1.05),
      ]),
      createHvCable([
        new THREE.Vector3(0.1, 0.16, -0.85),
        new THREE.Vector3(0.15, 0.28, -0.98),
        new THREE.Vector3(0.1, 0.38, -1.05),
      ]),
      createHvCable([
        new THREE.Vector3(0, 0.16, 0.85),
        new THREE.Vector3(0, 0.22, 0.96),
        new THREE.Vector3(0, 0.26, 1.02),
      ])
    );

    // =========================================================
    // 8. SUSPENSION GROUP (Chunky Rubber Tires & 5-Spoke Alloys)
    // =========================================================
    [
      { id: 'FL', x: -0.58, y: 0.26, z: 1.075, side: 'left' },
      { id: 'FR', x: 0.58, y: 0.26, z: 1.075, side: 'right' },
      { id: 'RL', x: -0.58, y: 0.26, z: -1.075, side: 'left' },
      { id: 'RR', x: 0.58, y: 0.26, z: -1.075, side: 'right' },
    ].forEach(({ id, x, y, z, side }) => {
      const cornerSub = new THREE.Group();
      cornerSub.name = `corner_${id}`;
      cornerSub.position.set(x, y, z);
      cornerSub.userData = { defaultX: x, side };

      // Chunky rounded turf rubber tire
      const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.22, 32), tireRubberMat);
      tire.rotateZ(Math.PI / 2);
      cornerSub.add(tire);

      // Rounded outer tire shoulders (gives chunky rounded golf cart tire profile)
      const outerShoulder = new THREE.Mesh(new THREE.TorusGeometry(0.23, 0.032, 12, 28), tireRubberMat);
      outerShoulder.position.set(side === 'left' ? -0.1 : 0.1, 0, 0);
      outerShoulder.rotateY(Math.PI / 2);
      const innerShoulder = new THREE.Mesh(new THREE.TorusGeometry(0.23, 0.032, 12, 28), tireRubberMat);
      innerShoulder.position.set(side === 'left' ? 0.1 : -0.1, 0, 0);
      innerShoulder.rotateY(Math.PI / 2);
      cornerSub.add(outerShoulder, innerShoulder);

      // Realistic deep-dish silver 5-spoke alloy rim
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.185, 0.185, 0.225, 24), wheelAlloyMat);
      rim.rotateZ(Math.PI / 2);
      cornerSub.add(rim);

      // 5 Sculpted silver alloy spokes
      for (let i = 0; i < 5; i++) {
        const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.145, 0.024), wheelAlloyMat);
        spoke.rotateZ((i * Math.PI * 2) / 5);
        spoke.position.set(side === 'left' ? -0.105 : 0.105, 0, 0);
        cornerSub.add(spoke);
      }

      // Chrome central hub cap
      const hubCap = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.02, 16), wheelAlloyMat);
      hubCap.rotateZ(Math.PI / 2);
      hubCap.position.set(side === 'left' ? -0.112 : 0.112, 0, 0);
      cornerSub.add(hubCap);

      // Brake rotor disc
      const rotor = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.015, 20), suspensionAlloyMat);
      rotor.rotateZ(Math.PI / 2);
      rotor.position.set(side === 'left' ? 0.06 : -0.06, 0, 0);
      cornerSub.add(rotor);

      // Brake caliper
      const caliper = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.075, 0.065), brakeCaliperMat);
      caliper.position.set(side === 'left' ? 0.06 : -0.06, 0.08, 0.05);
      cornerSub.add(caliper);

      // Strut coil spring
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.32, 12), coilSpringMat);
      strut.position.set(side === 'left' ? 0.15 : -0.15, 0.12, 0);
      strut.rotation.z = side === 'left' ? -0.2 : 0.2;
      cornerSub.add(strut);

      // Lower control arm
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.03, 0.04), suspensionAlloyMat);
      arm.position.set(side === 'left' ? 0.12 : -0.12, 0, 0);
      cornerSub.add(arm);

      suspensionGroup.add(cornerSub);
      suspCorners.push(cornerSub);
    });

    // Assemble All 7 Groups into Master
    master.add(chassisGroup);
    master.add(bodyPanelsGroup);
    master.add(canopyGroup);
    master.add(seatingGroup);
    master.add(batteryGroup);
    master.add(motorGroup);
    master.add(suspensionGroup);

    // Soft circular shadow-catching floor plane beneath the cart in studio lighting
    const shadowGeo = new THREE.PlaneGeometry(5.4, 3.8);
    const shadowCanvas = document.createElement('canvas');
    shadowCanvas.width = 256;
    shadowCanvas.height = 256;
    const ctx = shadowCanvas.getContext('2d');
    const grad = ctx.createRadialGradient(128, 128, 15, 128, 128, 124);
    grad.addColorStop(0, 'rgba(0, 0, 0, 0.90)');
    grad.addColorStop(0.35, 'rgba(0, 0, 0, 0.65)');
    grad.addColorStop(0.70, 'rgba(10, 14, 18, 0.25)');
    grad.addColorStop(1, 'rgba(19, 22, 27, 0.0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 256);

    const shadowTex = new THREE.CanvasTexture(shadowCanvas);
    const shadowMat = new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
    });
    const shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
    shadowMesh.rotation.x = -Math.PI / 2;
    shadowMesh.position.set(0, 0.003, 0);
    master.add(shadowMesh);

    // Store References
    groupsRef.current = {
      chassisGroup,
      bodyPanelsGroup,
      canopyGroup,
      seatingGroup,
      batteryGroup,
      motorGroup,
      suspensionGroup,
    };
    suspensionCornersRef.current = suspCorners;
    mainPaintMaterialsRef.current = mainPaintMats;
    bodyMaterialsRef.current = bodyMats;
    canopyMaterialsRef.current = canopyMats;
    batteryMaterialsRef.current = batteryMats;
    motorMaterialsRef.current = motorMats;
    suspensionMaterialsRef.current = suspMats;

    return master;
  }, []);

  // -------------------------------------------------------------
  // THREE.JS INITIALIZATION & LIFETIME RENDER LOOP (SINGLE MOUNT)
  // -------------------------------------------------------------
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    // Scene with Architectural Slate Studio Ambience
    const scene = new THREE.Scene();
    scene.background = null; // Let the CSS radial spotlight shine through
    scene.fog = new THREE.FogExp2(0x13161B, 0.035);
    sceneRef.current = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(
      42,
      window.innerWidth / window.innerHeight,
      0.1,
      100
    );
    camera.position.set(3.8, 1.8, 4.4);
    cameraRef.current = camera;

    // Renderer (Alpha enabled for studio spotlight)
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    renderer.setClearColor(0x13161b, 0);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    rendererRef.current = renderer;
    container.appendChild(renderer.domElement);

    // Architectural Studio Lighting
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x13161b, 0.95);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
    keyLight.position.set(5.5, 8.0, 5.0);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0x718096, 1.2);
    fillLight.position.set(-6.0, 4.5, -4.0);
    scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0xb0d5f8, 2.4);
    rimLight.position.set(0, 6.0, -6.5);
    scene.add(rimLight);

    // Cart Master Group
    const cart = buildProceduralCart();
    cartMasterGroupRef.current = cart;
    scene.add(cart);

    // Window Resize Handler
    const handleResize = () => {
      if (!cameraRef.current || !rendererRef.current) return;
      const w = window.innerWidth;
      const h = window.innerHeight;
      cameraRef.current.aspect = w / h;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    // Drag-to-Orbit Listeners
    const onPointerDown = (e) => {
      if (e.target.closest('button') || e.target.closest('header')) return;
      isDraggingRef.current = true;
      pointerStartRef.current = { x: e.clientX, y: e.clientY };
    };

    const onPointerMove = (e) => {
      if (!isDraggingRef.current) return;
      const deltaX = (e.clientX - pointerStartRef.current.x) * 0.005;
      const deltaY = (e.clientY - pointerStartRef.current.y) * 0.005;
      pointerStartRef.current = { x: e.clientX, y: e.clientY };

      targetOrbitOffsetRef.current.yaw += deltaX;
      targetOrbitOffsetRef.current.pitch = THREE.MathUtils.clamp(
        targetOrbitOffsetRef.current.pitch + deltaY,
        -0.45,
        0.45
      );
    };

    const onPointerUp = () => {
      isDraggingRef.current = false;
    };

    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);

    // Animation & Render Loop
    let animationFrameId;
    const clock = new THREE.Clock();

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      const elapsedTime = clock.getElapsedTime();

      // Smooth Orbit Drag Damping
      orbitOffsetRef.current.yaw = THREE.MathUtils.lerp(
        orbitOffsetRef.current.yaw,
        targetOrbitOffsetRef.current.yaw,
        0.08
      );
      orbitOffsetRef.current.pitch = THREE.MathUtils.lerp(
        orbitOffsetRef.current.pitch,
        targetOrbitOffsetRef.current.pitch,
        0.08
      );

      // Read Dynamic Inputs from Refs (Zero React Re-mounts)
      const p = scrollProgressRef.current;
      const groups = groupsRef.current;
      const cartMaster = cartMasterGroupRef.current;
      const sub = activeSubsystemRef.current;
      const expOverride = explosionOverrideRef.current;

      const targetCamPos = new THREE.Vector3();
      const targetLook = new THREE.Vector3(0, 0.6, 0);

      // =========================================================
      // STAGE 01: [0.00, 0.25) - Hero Front-3/4 Angle
      // =========================================================
      if (p < 0.25) {
        const t = p / 0.25;
        targetCamPos.set(
          THREE.MathUtils.lerp(3.8, 3.2, t),
          THREE.MathUtils.lerp(1.7, 1.4, t),
          THREE.MathUtils.lerp(4.4, 3.8, t)
        );
        targetLook.set(
          THREE.MathUtils.lerp(-0.5, 0.3, t),
          THREE.MathUtils.lerp(0.55, 0.45, t),
          THREE.MathUtils.lerp(0.0, 0.95, t)
        );

        // Subtle Idle Hover Breathing
        if (cartMaster) {
          const hoverY = Math.sin(elapsedTime * 1.8) * 0.035 * (1 - t * 0.8);
          const hoverRoll = Math.cos(elapsedTime * 1.3) * 0.008 * (1 - t * 0.8);
          cartMaster.position.y = hoverY;
          cartMaster.rotation.z = hoverRoll;
        }

        // Restore Solid Body Materials
        bodyMaterialsRef.current.forEach((m) => {
          if (m.wireframe !== false) m.wireframe = false;
          if (m.opacity !== 1.0) {
            m.transparent = false;
            m.opacity = 1.0;
          }
        });
        canopyMaterialsRef.current.forEach((m) => {
          if (m.wireframe !== false) m.wireframe = false;
        });
      }
      // =========================================================
      // STAGE 02: [0.25, 0.50) - 3-Beat Orbit
      // =========================================================
      else if (p < 0.5) {
        const t = (p - 0.25) / 0.25;

        if (cartMaster) {
          cartMaster.position.y = 0;
          cartMaster.rotation.z = 0;
        }

        // Beat 1: tight front-3/4 headlights (t: 0.0 -> 0.35)
        // Beat 2: strict 90° side profile (t: 0.35 -> 0.70)
        // Beat 3: sweeping rear-3/4 taillight (t: 0.70 -> 1.0)
        if (t < 0.35) {
          const subT = t / 0.35;
          targetCamPos.set(
            THREE.MathUtils.lerp(3.2, 1.75, subT),
            THREE.MathUtils.lerp(1.4, 0.75, subT),
            THREE.MathUtils.lerp(3.8, 2.15, subT)
          );
          targetLook.set(0.3, 0.45, 0.95);
        } else if (t < 0.7) {
          const subT = (t - 0.35) / 0.35;
          targetCamPos.set(
            THREE.MathUtils.lerp(1.75, 4.6, subT),
            THREE.MathUtils.lerp(0.75, 0.85, subT),
            THREE.MathUtils.lerp(2.15, 0.0, subT)
          );
          targetLook.set(0, 0.55, 0);
        } else {
          const subT = (t - 0.7) / 0.3;
          targetCamPos.set(
            THREE.MathUtils.lerp(4.6, -3.2, subT),
            THREE.MathUtils.lerp(0.85, 1.25, subT),
            THREE.MathUtils.lerp(0.0, -3.8, subT)
          );
          targetLook.set(0, 0.55, -0.4);
        }

        bodyMaterialsRef.current.forEach((m) => {
          if (m.wireframe !== false) m.wireframe = false;
          if (m.opacity !== 1.0) {
            m.transparent = false;
            m.opacity = 1.0;
          }
        });
        canopyMaterialsRef.current.forEach((m) => {
          if (m.wireframe !== false) m.wireframe = false;
        });
      }
      // =========================================================
      // STAGE 03: [0.50, 0.75) - Exploded Assembly
      // =========================================================
      else if (p < 0.75) {
        const t = (p - 0.5) / 0.25;
        targetCamPos.set(
          THREE.MathUtils.lerp(-3.2, 3.6, t),
          THREE.MathUtils.lerp(1.25, 2.9, t),
          THREE.MathUtils.lerp(-3.8, 4.1, t)
        );
        targetLook.set(0, 0.55, 0);

        let explosionTarget = t;
        if (expOverride !== null) {
          explosionTarget = expOverride;
        }

        currentExplosionRef.current = THREE.MathUtils.lerp(
          currentExplosionRef.current,
          explosionTarget,
          0.08
        );

        bodyMaterialsRef.current.forEach((m) => {
          if (m.wireframe !== false) m.wireframe = false;
        });
        canopyMaterialsRef.current.forEach((m) => {
          if (m.wireframe !== false) m.wireframe = false;
        });
      }
      // =========================================================
      // STAGE 04: [0.75, 1.00] - X-Ray Cutaway
      // =========================================================
      else {
        const t = (p - 0.75) / 0.25;

        if (sub === '01') {
          // Battery Focus
          targetCamPos.set(2.0, 0.45, 1.2);
          targetLook.set(0, 0.2, 0);
        } else if (sub === '02') {
          // Motor Focus
          targetCamPos.set(-1.6, 0.75, -2.1);
          targetLook.set(0, 0.35, -1.05);
        } else if (sub === '03') {
          // Suspension Focus
          targetCamPos.set(1.9, 0.55, 1.6);
          targetLook.set(0.58, 0.3, 1.075);
        } else {
          // Full Cutaway Overview
          targetCamPos.set(
            THREE.MathUtils.lerp(3.6, 3.1, t),
            THREE.MathUtils.lerp(2.9, 1.75, t),
            THREE.MathUtils.lerp(4.1, 3.6, t)
          );
          targetLook.set(0, 0.55, 0);
        }

        // Return explosion to 0 for assembled cutaway
        currentExplosionRef.current = THREE.MathUtils.lerp(
          currentExplosionRef.current,
          0,
          0.08
        );

        // Turn Outer Body Panels & Canopy into Translucent Wireframe
        bodyMaterialsRef.current.forEach((m) => {
          if (m.wireframe !== true) m.wireframe = true;
          m.transparent = true;
          m.opacity = 0.22;
        });
        canopyMaterialsRef.current.forEach((m) => {
          if (m.wireframe !== true) m.wireframe = true;
          m.transparent = true;
          m.opacity = 0.18;
        });

        // Dynamic Pulsing Internal Subsystem Glow
        const pulse = 1.0 + Math.sin(elapsedTime * 4.0) * 0.4;
        batteryMaterialsRef.current.forEach((m) => {
          if (m.emissive) m.emissiveIntensity = (sub === '01' ? 4.5 : 1.4) * pulse;
        });
        motorMaterialsRef.current.forEach((m) => {
          if (m.emissive) m.emissiveIntensity = (sub === '02' ? 4.0 : 1.2) * pulse;
        });
        suspensionMaterialsRef.current.forEach((m) => {
          if (m.emissive) m.emissiveIntensity = (sub === '03' ? 3.5 : 0.9) * pulse;
        });
      }

      // Smooth Camera Lerp
      camera.position.lerp(targetCamPos, 0.08);

      // Apply Drag Orbit Offset
      const rotatedPos = camera.position.clone();
      rotatedPos.applyAxisAngle(new THREE.Vector3(0, 1, 0), orbitOffsetRef.current.yaw);
      camera.position.copy(rotatedPos);
      camera.position.y += orbitOffsetRef.current.pitch * 1.5;

      currentCameraLookAtRef.current.lerp(targetLook, 0.08);
      camera.lookAt(currentCameraLookAtRef.current);

      // Explode the 7 Groups outward along their axes
      const ef = currentExplosionRef.current;
      if (groups.canopyGroup) groups.canopyGroup.position.set(0, ef * 1.45, ef * 0.1);
      if (groups.bodyPanelsGroup) groups.bodyPanelsGroup.position.set(ef * 0.2, ef * 0.65, ef * 0.3);
      if (groups.seatingGroup) groups.seatingGroup.position.set(0, ef * 0.52, 0);
      if (groups.chassisGroup) groups.chassisGroup.position.set(0, 0, 0); // Anchor Datum
      if (groups.batteryGroup) groups.batteryGroup.position.set(0, -ef * 0.62, 0);
      if (groups.motorGroup) groups.motorGroup.position.set(0, -ef * 0.22, -ef * 0.72);

      // Lateral Expansion of 4 Suspension Corners
      suspensionCornersRef.current.forEach((corner) => {
        const sideMult = corner.userData.side === 'left' ? -1 : 1;
        corner.position.x = corner.userData.defaultX + sideMult * ef * 0.55;
      });

      // Project 3D World Positions to 2D Screen Coordinates for Stage 03 Pins
      if (p >= 0.45 && p <= 0.8) {
        const coords = {};
        const widthHalf = window.innerWidth / 2;
        const heightHalf = window.innerHeight / 2;

        ASSEMBLY_PINS.forEach((pin) => {
          const group = groups[pin.groupKey];
          if (!group) return;

          const worldPos = pin.localPos.clone().add(group.position);
          worldPos.project(camera);

          const x = worldPos.x * widthHalf + widthHalf;
          const y = -(worldPos.y * heightHalf) + heightHalf;
          const isVisible = worldPos.z < 1;
          coords[pin.id] = { x, y, isVisible };
        });

        setPinScreenCoords(coords);
      }

      renderer.render(scene, camera);
    };

    animate();

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);

      if (container && renderer.domElement) {
        container.removeChild(renderer.domElement);
      }
      renderer.dispose();
    };
  }, [buildProceduralCart]);

  // -------------------------------------------------------------
  // ULTRA-SMOOTH SCROLL LISTENER (NO WEBGL RE-CREATION)
  // -------------------------------------------------------------
  useEffect(() => {
    const handleScroll = () => {
      const scrollY = window.scrollY || window.pageYOffset;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      const progress = THREE.MathUtils.clamp(docHeight > 0 ? scrollY / docHeight : 0, 0, 1);

      scrollProgressRef.current = progress;
      setScrollProgressDisplay(progress);

      // Determine Stage & Beat
      if (progress < 0.25) {
        setActiveStageIndex(0);
      } else if (progress < 0.5) {
        setActiveStageIndex(1);
        const beatT = (progress - 0.25) / 0.25;
        if (beatT < 0.35) setStage2Beat(0);
        else if (beatT < 0.7) setStage2Beat(1);
        else setStage2Beat(2);
      } else if (progress < 0.75) {
        setActiveStageIndex(2);
      } else {
        setActiveStageIndex(3);
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Jump to Stage Helper
  const jumpToStage = (stageIdx) => {
    const docHeight = document.documentElement.scrollHeight - window.innerHeight;
    const targets = [0.0, 0.32, 0.58, 0.88];
    window.scrollTo({
      top: targets[stageIdx] * docHeight,
      behavior: 'smooth',
    });
  };

  return (
    <div
      className="qartix-student-landing"
      style={{
        minHeight: '400vh',
        backgroundColor: '#13161B',
        backgroundImage: 'radial-gradient(circle at 60% 45%, #242A34 0%, #13161B 70%)',
        color: '#F4F5F7',
        fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
      }}
    >
      {/* Google Fonts Import for Bricolage Grotesque, DM Sans, IBM Plex Mono */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700;12..96,800;12..96,900&family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=IBM+Plex+Mono:ital,wght@0,500;0,600;0,700;1,500&display=swap');
      `}</style>

      {/* -------------------------------------------------------- */}
      {/* 1. TOP FIXED NAVBAR                                      */}
      {/* -------------------------------------------------------- */}
      <header
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          height: '68px',
          zIndex: 60,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 32px',
          background: 'rgba(28, 33, 40, 0.88)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.12)',
          userSelect: 'none',
        }}
      >
        {/* Left: Brand Logo & Student ID Badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <div
            style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}
            onClick={() => jumpToStage(0)}
            title="Return to Hero (Stage 01)"
          >
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                background: '#13161B',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '2px 2px 0px #0D1013',
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#F4F5F7" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="8" />
                <path d="m15.5 15.5 3.5 3.5" />
                <path d="M9 12h6" />
              </svg>
            </div>
            <div>
              <div style={{ fontSize: '15px', fontWeight: 800, letterSpacing: '0.12em', lineHeight: 1.1, color: '#F4F5F7' }}>QARTIX</div>
              <div style={{ fontSize: '9px', fontWeight: 600, letterSpacing: '0.18em', color: '#9CA3AF', textTransform: 'uppercase' }}>CAMPUS EV</div>
            </div>
          </div>

          {/* Student ID Badge */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '5px 12px',
              borderRadius: '20px',
              background: '#13161B',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              fontSize: '11px',
              fontWeight: 600,
              letterSpacing: '0.04em',
            }}
          >
            <span
              style={{
                width: '7px',
                height: '7px',
                borderRadius: '50%',
                background: '#2E6F5E',
                boxShadow: '0 0 6px #2E6F5E',
              }}
            />
            <span style={{ color: '#9CA3AF' }}>ID:</span>
            <span style={{ color: '#F4F5F7', fontWeight: 700 }}>{student?.studentId || student?.loginIdentifier || studentId}</span>
          </div>
        </div>

        {/* Right: Dashboard Jump & Log Out */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {/* Book Pass / Dashboard Button */}
          <button
            type="button"
            onClick={onBookPass}
            style={{
              padding: '8px 18px',
              borderRadius: '8px',
              background: '#10B981',
              color: '#0B1116',
              border: '1px solid #10B981',
              boxShadow: '0 4px 14px rgba(16, 185, 129, 0.25), 2px 2px 0px #0D1013',
              fontSize: '11px',
              fontWeight: 900,
              letterSpacing: '0.06em',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#34D399';
              e.currentTarget.style.boxShadow = '0 6px 18px rgba(16, 185, 129, 0.4), 2px 2px 0px #0D1013';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = '#10B981';
              e.currentTarget.style.boxShadow = '0 4px 14px rgba(16, 185, 129, 0.25), 2px 2px 0px #0D1013';
            }}
          >
            BOOK PASS / DASHBOARD
          </button>

          {/* Log Out Button */}
          <button
            type="button"
            onClick={onLogout}
            style={{
              padding: '8px 14px',
              borderRadius: '8px',
              background: '#1C2128',
              color: '#9CA3AF',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              fontSize: '11px',
              fontWeight: 700,
              letterSpacing: '0.04em',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            LOG OUT
          </button>
        </div>
      </header>

      {/* -------------------------------------------------------- */}
      {/* 2. STICKY FULL-SCREEN THREE.JS CANVAS                    */}
      {/* -------------------------------------------------------- */}
      <div
        ref={mountRef}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 10,
          width: '100vw',
          height: '100vh',
          pointerEvents: 'auto',
          cursor: 'grab',
        }}
      />

      {/* -------------------------------------------------------- */}
      {/* PERSISTENT MINIMAL STAGE COUNTER (01 / 04)               */}
      {/* -------------------------------------------------------- */}
      <div
        style={{
          position: 'fixed',
          bottom: '36px',
          left: '36px',
          zIndex: 50,
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
          padding: '10px 18px',
          background: 'rgba(28, 33, 40, 0.88)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          borderRadius: '12px',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          boxShadow: '0 4px 16px rgba(0, 0, 0, 0.35)',
          userSelect: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
          <span style={{ fontSize: '20px', fontWeight: 800, fontFamily: 'monospace', color: '#F4F5F7' }}>
            {STAGES[activeStageIndex].code}
          </span>
          <span style={{ fontSize: '13px', fontWeight: 500, color: '#9CA3AF' }}>/ 04</span>
        </div>
        <div style={{ width: '1px', height: '22px', background: 'rgba(255, 255, 255, 0.12)' }} />
        <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.12em', color: '#9CA3AF' }}>
          {STAGES[activeStageIndex].label}
        </div>
        {/* Mini Stage Navigation Pips */}
        <div style={{ display: 'flex', gap: '4px', marginLeft: '6px' }}>
          {STAGES.map((s, idx) => (
            <button
              key={s.id}
              type="button"
              onClick={() => jumpToStage(idx)}
              style={{
                width: idx === activeStageIndex ? '18px' : '6px',
                height: '6px',
                borderRadius: '3px',
                background: idx === activeStageIndex ? '#F4F5F7' : 'rgba(255, 255, 255, 0.2)',
                border: 'none',
                cursor: 'pointer',
                transition: 'all 0.25s ease',
              }}
              title={`Jump to Stage ${s.code}`}
            />
          ))}
        </div>
      </div>

      {/* -------------------------------------------------------- */}
      {/* STAGE 01 HUD (HERO STAGE)                                */}
      {/* -------------------------------------------------------- */}
      {activeStageIndex === 0 && (
        <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 40 }}>
          {/* Clickable Paint Finish Swatches */}
          <div
            style={{
              position: 'fixed',
              right: '36px',
              top: '50%',
              transform: 'translateY(-50%)',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              padding: '16px 12px',
              background: 'rgba(28, 33, 40, 0.88)',
              backdropFilter: 'blur(12px)',
              borderRadius: '16px',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              boxShadow: '0 4px 20px rgba(0, 0, 0, 0.4)',
              pointerEvents: 'auto',
            }}
          >
            <div style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.12em', color: '#9CA3AF', textAlign: 'center', marginBottom: '4px' }}>
              FINISH
            </div>
            {PAINT_SWATCHES.map((swatch) => {
              const isSelected = activeSwatch === swatch.hex;
              return (
                <button
                  key={swatch.id}
                  type="button"
                  onClick={() => handleSelectSwatch(swatch.hex)}
                  title={swatch.name}
                  style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '50%',
                    background: swatch.hex,
                    border: isSelected ? '2px solid #F4F5F7' : '2px solid rgba(255, 255, 255, 0.15)',
                    boxShadow: isSelected ? '0 0 0 3px rgba(232, 80, 40, 0.4)' : '0 2px 6px rgba(0,0,0,0.3)',
                    cursor: 'pointer',
                    transform: isSelected ? 'scale(1.12)' : 'scale(1.0)',
                    transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
                  }}
                />
              );
            })}
          </div>

          {/* Fading Scroll Cue */}
          <div
            style={{
              position: 'fixed',
              bottom: '40px',
              left: '50%',
              transform: 'translateX(-50%)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '6px',
              fontSize: '11px',
              fontWeight: 700,
              letterSpacing: '0.16em',
              color: '#9CA3AF',
              opacity: Math.max(0, 1 - scrollProgressDisplay * 15),
              transition: 'opacity 0.2s ease',
              userSelect: 'none',
            }}
          >
            <span>SCROLL TO ANIMATE</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14" />
              <path d="m19 12-7 7-7-7" />
            </svg>
          </div>

          {/* MINIMAL STAGE 01 HERO TYPOGRAPHY (Directly on Architectural Slate, max-w-[380px]) */}
          <div
            style={{
              position: 'fixed',
              top: '130px',
              left: '48px',
              width: '100%',
              maxWidth: '380px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
              pointerEvents: 'auto',
              zIndex: 30,
            }}
          >
            {/* Small Mono Tag (IBM Plex Mono, #2E6F5E dot) */}
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
              <span
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  backgroundColor: '#2E6F5E',
                  boxShadow: '0 0 8px #2E6F5E',
                }}
              />
              <span
                style={{
                  fontFamily: '"IBM Plex Mono", "JetBrains Mono", monospace',
                  fontSize: '11px',
                  fontWeight: 800,
                  letterSpacing: '0.1em',
                  color: '#9CA3AF',
                  textTransform: 'uppercase',
                }}
              >
                MONTHLY CAMPUS PASS
              </span>
            </div>

            {/* Headline (Bricolage Grotesque, Bold) */}
            <h1
              style={{
                fontFamily: '"Bricolage Grotesque", "Inter", sans-serif',
                fontSize: '38px',
                fontWeight: 900,
                lineHeight: 1.12,
                letterSpacing: '-0.025em',
                color: '#F4F5F7',
                margin: 0,
              }}
            >
              Class shouldn't wait for recovery.
            </h1>

            {/* 1-Line Subtext (DM Sans) */}
            <p
              style={{
                fontFamily: '"DM Sans", "Inter", sans-serif',
                fontSize: '14px',
                lineHeight: 1.5,
                color: '#9CA3AF',
                margin: 0,
              }}
            >
              Electric cart rides from your hostel or main gate straight to class.
            </p>

            {/* Single CTA Button (#10B981 with 3px 3px 0px #0D1013 shadow) */}
            <div style={{ paddingTop: '6px' }}>
              <button
                type="button"
                onClick={onBookPass}
                style={{
                  backgroundColor: '#10B981',
                  color: '#0B1116',
                  border: '1px solid #10B981',
                  boxShadow: '0 4px 14px rgba(16, 185, 129, 0.25), 3px 3px 0px #0D1013',
                  borderRadius: '8px',
                  padding: '13px 22px',
                  fontSize: '13px',
                  fontWeight: 900,
                  letterSpacing: '0.04em',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = '#34D399';
                  e.currentTarget.style.boxShadow = '0 6px 20px rgba(16, 185, 129, 0.4), 3px 3px 0px #0D1013';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = '#10B981';
                  e.currentTarget.style.boxShadow = '0 4px 14px rgba(16, 185, 129, 0.25), 3px 3px 0px #0D1013';
                }}
                onMouseDown={(e) => (e.currentTarget.style.transform = 'translate(1px, 1px)')}
                onMouseUp={(e) => (e.currentTarget.style.transform = 'translate(0, 0)')}
              >
                <span>Book Monthly Pass →</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* -------------------------------------------------------- */}
      {/* STAGE 02 HUD (3-BEAT ORBIT & DIMENSION TICKS)             */}
      {/* -------------------------------------------------------- */}
      {activeStageIndex === 1 && (
        <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 40 }}>
          {/* Animated Numeric-Only SVG Dimension Ticks (Active During Side Profile Beat) */}
          {stage2Beat === 1 && (
            <div
              style={{
                position: 'fixed',
                inset: 0,
                pointerEvents: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <svg style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0 }}>
                {/* 1. Ground Clearance: 180 MM */}
                <g style={{ transform: 'translate(44%, 72%)' }}>
                  <line x1="0" y1="0" x2="0" y2="40" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" strokeDasharray="3 3" />
                  <line x1="-8" y1="0" x2="8" y2="0" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" />
                  <line x1="-8" y1="40" x2="8" y2="40" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" />
                  <rect x="14" y="10" width="68" height="20" rx="4" fill="#1C2128" stroke="rgba(255,255,255,0.15)" strokeWidth="1" />
                  <text x="48" y="24" fill="#F4F5F7" fontSize="10" fontWeight="700" fontFamily="monospace" textAnchor="middle">
                    180 MM
                  </text>
                </g>

                {/* 2. Wheelbase: 2,150 MM */}
                <g style={{ transform: 'translate(28%, 62%)' }}>
                  <line x1="0" y1="0" x2="480" y2="0" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" strokeDasharray="4 4" />
                  <line x1="0" y1="-12" x2="0" y2="12" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" />
                  <line x1="480" y1="-12" x2="480" y2="12" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" />
                  <rect x="200" y="-12" width="80" height="24" rx="4" fill="#1C2128" stroke="rgba(255,255,255,0.15)" strokeWidth="1" />
                  <text x="240" y="4" fill="#F4F5F7" fontSize="11" fontWeight="700" fontFamily="monospace" textAnchor="middle">
                    2,150 MM
                  </text>
                </g>

                {/* 3. Overall Length: 2.8 M */}
                <g style={{ transform: 'translate(22%, 35%)' }}>
                  <line x1="0" y1="0" x2="620" y2="0" stroke="rgba(255,255,255,0.4)" strokeWidth="1.2" strokeDasharray="4 4" />
                  <line x1="0" y1="-10" x2="0" y2="10" stroke="rgba(255,255,255,0.4)" strokeWidth="1.2" />
                  <line x1="620" y1="-10" x2="620" y2="10" stroke="rgba(255,255,255,0.4)" strokeWidth="1.2" />
                  <rect x="275" y="-12" width="70" height="24" rx="4" fill="#1C2128" stroke="rgba(255,255,255,0.15)" strokeWidth="1" />
                  <text x="310" y="4" fill="#F4F5F7" fontSize="11" fontWeight="700" fontFamily="monospace" textAnchor="middle">
                    2.8 M
                  </text>
                </g>
              </svg>
            </div>
          )}

          {/* BEAT 01: Easy Boarding (Front-3/4 view, max-w-[320px]) */}
          {(stage2Beat === 0 || stage2Beat === 1) && (
            <div
              style={{
                position: 'fixed',
                top: '130px',
                left: '48px',
                width: '100%',
                maxWidth: '320px',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                pointerEvents: 'auto',
                zIndex: 30,
              }}
            >
              <div
                style={{
                  fontFamily: '"IBM Plex Mono", "JetBrains Mono", monospace',
                  fontSize: '11px',
                  fontWeight: 800,
                  letterSpacing: '0.1em',
                  color: '#10B981',
                  textTransform: 'uppercase',
                }}
              >
                01 • EASY BOARDING
              </div>
              <h2
                style={{
                  fontFamily: '"Bricolage Grotesque", "Inter", sans-serif',
                  fontSize: '28px',
                  fontWeight: 900,
                  color: '#F4F5F7',
                  margin: 0,
                  letterSpacing: '-0.02em',
                  lineHeight: 1.15,
                }}
              >
                Low-Step Entry
              </h2>
              <p
                style={{
                  fontFamily: '"DM Sans", "Inter", sans-serif',
                  fontSize: '13px',
                  color: '#9CA3AF',
                  lineHeight: 1.5,
                  margin: 0,
                }}
              >
                Built for crutches, casts, and recovery.
              </p>
            </div>
          )}

          {/* BEAT 03: Fixed Timings (Rear-3/4 view, max-w-[320px]) */}
          {(stage2Beat === 1 || stage2Beat === 2) && (
            <div
              style={{
                position: 'fixed',
                bottom: '90px',
                right: '48px',
                width: '100%',
                maxWidth: '320px',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                pointerEvents: 'auto',
                zIndex: 30,
              }}
            >
              <div
                style={{
                  fontFamily: '"IBM Plex Mono", "JetBrains Mono", monospace',
                  fontSize: '11px',
                  fontWeight: 800,
                  letterSpacing: '0.1em',
                  color: '#2E6F5E',
                  textTransform: 'uppercase',
                }}
              >
                02 • FIXED TIMINGS
              </div>
              <h2
                style={{
                  fontFamily: '"Bricolage Grotesque", "Inter", sans-serif',
                  fontSize: '28px',
                  fontWeight: 900,
                  color: '#F4F5F7',
                  margin: 0,
                  letterSpacing: '-0.02em',
                  lineHeight: 1.15,
                }}
              >
                Synced to Classes
              </h2>
              <p
                style={{
                  fontFamily: '"DM Sans", "Inter", sans-serif',
                  fontSize: '13px',
                  color: '#9CA3AF',
                  lineHeight: 1.5,
                  margin: 0,
                }}
              >
                Daily pickups at your gate, right on time.
              </p>
              {/* Compact Mono Pill in Dark Slate */}
              <div style={{ paddingTop: '4px' }}>
                <span
                  style={{
                    display: 'inline-block',
                    fontFamily: '"IBM Plex Mono", monospace',
                    fontSize: '10px',
                    fontWeight: 800,
                    color: '#F4F5F7',
                    backgroundColor: '#1C2128',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    boxShadow: '2px 2px 0px #0D1013',
                    borderRadius: '6px',
                    padding: '5px 10px',
                    letterSpacing: '0.04em',
                  }}
                >
                  HOSTEL / GATE → BLOCK
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* -------------------------------------------------------- */}
      {/* STAGE 03 HUD (EXPLODED ASSEMBLY & 5 PROJECTED PINS)      */}
      {/* -------------------------------------------------------- */}
      {activeStageIndex === 2 && (
        <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 40 }}>
          {/* Assembled / Exploded Toggle */}
          <div
            style={{
              position: 'fixed',
              top: '90px',
              right: '36px',
              display: 'flex',
              gap: '6px',
              padding: '6px',
              background: 'rgba(28, 33, 40, 0.88)',
              backdropFilter: 'blur(12px)',
              borderRadius: '10px',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              pointerEvents: 'auto',
              boxShadow: '3px 3px 0px #0D1013',
            }}
          >
            <button
              type="button"
              onClick={() => {
                setExplosionOverride(0);
                explosionOverrideRef.current = 0;
                setIsolatedPin(null);
                isolatedPinRef.current = null;
              }}
              style={{
                padding: '6px 14px',
                borderRadius: '6px',
                background: explosionOverride === 0 ? '#13161B' : 'transparent',
                color: explosionOverride === 0 ? '#F4F5F7' : '#9CA3AF',
                border: 'none',
                fontSize: '11px',
                fontWeight: 700,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
            >
              ASSEMBLED
            </button>
            <button
              type="button"
              onClick={() => {
                setExplosionOverride(1);
                explosionOverrideRef.current = 1;
              }}
              style={{
                padding: '6px 14px',
                borderRadius: '6px',
                background: explosionOverride === 1 || explosionOverride === null ? '#13161B' : 'transparent',
                color: explosionOverride === 1 || explosionOverride === null ? '#F4F5F7' : '#9CA3AF',
                border: 'none',
                fontSize: '11px',
                fontWeight: 700,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
            >
              EXPLODED
            </button>
          </div>

          {/* 5 Live 3D-to-2D Projected Clickable Pins (A-E) */}
          {ASSEMBLY_PINS.map((pin) => {
            const coord = pinScreenCoords[pin.id];
            if (!coord || !coord.isVisible) return null;
            const isIsolated = isolatedPin === pin.id;

            return (
              <div
                key={pin.id}
                style={{
                  position: 'fixed',
                  left: `${coord.x}px`,
                  top: `${coord.y}px`,
                  transform: 'translate(-50%, -50%)',
                  pointerEvents: 'auto',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  zIndex: 45,
                }}
              >
                <button
                  type="button"
                  onClick={() => handleTogglePin(pin.id)}
                  style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '50%',
                    background: isIsolated ? '#10B981' : '#1C2128',
                    color: isIsolated ? '#0B1116' : '#FFFFFF',
                    border: isIsolated ? '2px solid #10B981' : '2px solid rgba(255, 255, 255, 0.25)',
                    boxShadow: isIsolated ? '0 0 12px rgba(16, 185, 129, 0.5), 0 0 0 3px #10B981' : '2px 2px 0px #0D1013',
                    fontSize: '12px',
                    fontWeight: 900,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'all 0.15s ease',
                  }}
                  title={`Select ${pin.label}`}
                >
                  {pin.id}
                </button>

                {/* Compact 2-word label badge shown on click */}
                {isIsolated && (
                  <div
                    style={{
                      background: '#1C2128',
                      color: '#F4F5F7',
                      padding: '4px 10px',
                      borderRadius: '6px',
                      fontSize: '11px',
                      fontWeight: 800,
                      letterSpacing: '0.04em',
                      fontFamily: '"IBM Plex Mono", monospace',
                      whiteSpace: 'nowrap',
                      pointerEvents: 'none',
                      border: '1px solid rgba(255, 255, 255, 0.12)',
                      boxShadow: '2px 2px 0px #10B981',
                    }}
                  >
                    {pin.label}
                  </div>
                )}
              </div>
            );
          })}

          {/* Reset Isolation Bar */}
          {Boolean(isolatedPin) ? (
            <div
              style={{
                position: 'fixed',
                top: '90px',
                left: '50%',
                transform: 'translateX(-50%)',
                padding: '6px 14px',
                borderRadius: '8px',
                background: '#1C2128',
                color: '#F4F5F7',
                fontSize: '11px',
                fontWeight: 800,
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                pointerEvents: 'auto',
                boxShadow: '2px 2px 0px #10B981',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                zIndex: 45,
              }}
            >
              <span style={{ color: '#F4C430', fontFamily: 'monospace' }}>
                ● {ASSEMBLY_PINS.find((p) => p.id === isolatedPin)?.label}
              </span>
              <button
                type="button"
                onClick={() => handleTogglePin(isolatedPin)}
                title="Reset Isolation"
                style={{
                  padding: '3px 8px',
                  borderRadius: '4px',
                  background: '#10B981',
                  color: '#0B1116',
                  border: 'none',
                  fontSize: '10px',
                  fontWeight: 900,
                  cursor: 'pointer',
                }}
              >
                RESET
              </button>
            </div>
          ) : null}

          {/* MINIMAL STAGE 03 LIST (Directly on Architectural Slate, max-w-[320px]) */}
          <div
            style={{
              position: 'fixed',
              top: '130px',
              left: '48px',
              width: '100%',
              maxWidth: '320px',
              display: 'flex',
              flexDirection: 'column',
              gap: '14px',
              pointerEvents: 'auto',
              zIndex: 30,
            }}
          >
            <h2
              style={{
                fontFamily: '"Bricolage Grotesque", "Inter", sans-serif',
                fontSize: '28px',
                fontWeight: 900,
                color: '#F4F5F7',
                margin: 0,
                letterSpacing: '-0.02em',
                lineHeight: 1.15,
              }}
            >
              How It Works
            </h2>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {[
                { step: '01', title: 'Verify', desc: 'Upload medical slip' },
                { step: '02', title: 'Schedule', desc: 'Set daily stops' },
                { step: '03', title: 'Ride', desc: 'Show digital pass' },
              ].map((item) => (
                <div
                  key={item.step}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    fontSize: '13px',
                    fontFamily: '"DM Sans", "Inter", sans-serif',
                  }}
                >
                  <span
                    style={{
                      fontFamily: '"IBM Plex Mono", monospace',
                      fontSize: '10px',
                      fontWeight: 800,
                      backgroundColor: '#1C2128',
                      color: '#F4F5F7',
                      border: '1px solid rgba(255, 255, 255, 0.12)',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      flexShrink: 0,
                    }}
                  >
                    {item.step}
                  </span>
                  <div>
                    <strong style={{ color: '#F4F5F7', fontWeight: 800 }}>{item.title}</strong>
                    <span style={{ color: '#64748b', margin: '0 4px' }}>—</span>
                    <span style={{ color: '#9CA3AF' }}>{item.desc}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* -------------------------------------------------------- */}
      {/* STAGE 04 HUD (X-RAY CUTAWAY & SUBSYSTEM FOCUS)           */}
      {/* -------------------------------------------------------- */}
      {activeStageIndex === 3 && (
        <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 40 }}>
          {/* Minimal 01, 02, 03 Buttons with Dark Slate styling */}
          <div
            style={{
              position: 'fixed',
              top: '90px',
              right: '36px',
              display: 'flex',
              gap: '6px',
              padding: '6px',
              background: '#1C2128',
              borderRadius: '10px',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              boxShadow: '3px 3px 0px #0D1013',
              pointerEvents: 'auto',
            }}
          >
            {[
              { id: 'ALL', label: 'ALL', sub: 'OVERVIEW' },
              { id: '01', label: '01', sub: 'BATTERY' },
              { id: '02', label: '02', sub: 'MOTOR' },
              { id: '03', label: '03', sub: 'SUSPENSION' },
            ].map((s) => {
              const isActive = activeSubsystem === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    setActiveSubsystem(s.id);
                    activeSubsystemRef.current = s.id;
                  }}
                  style={{
                    padding: '8px 14px',
                    borderRadius: '6px',
                    background: isActive ? '#13161B' : 'transparent',
                    color: isActive ? '#F4F5F7' : '#9CA3AF',
                    border: 'none',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '2px',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <span style={{ fontSize: '13px', fontWeight: 900, fontFamily: 'monospace' }}>{s.label}</span>
                  <span style={{ fontSize: '8px', fontWeight: 800, letterSpacing: '0.08em', opacity: isActive ? 0.9 : 0.6 }}>{s.sub}</span>
                </button>
              );
            })}
          </div>

          {/* MINIMAL STAGE 04 CLOSING CONTENT (Directly on Architectural Slate, max-w-[340px]) */}
          <div
            style={{
              position: 'fixed',
              top: '130px',
              left: '48px',
              width: '100%',
              maxWidth: '340px',
              display: 'flex',
              flexDirection: 'column',
              gap: '14px',
              pointerEvents: 'auto',
              zIndex: 30,
            }}
          >
            {/* Mono Tag */}
            <div
              style={{
                fontFamily: '"IBM Plex Mono", "JetBrains Mono", monospace',
                fontSize: '11px',
                fontWeight: 800,
                letterSpacing: '0.1em',
                color: '#10B981',
                textTransform: 'uppercase',
              }}
            >
              04 • CAMPUS FLEET
            </div>

            {/* Title */}
            <h2
              style={{
                fontFamily: '"Bricolage Grotesque", "Inter", sans-serif',
                fontSize: '32px',
                fontWeight: 900,
                color: '#F4F5F7',
                margin: 0,
                letterSpacing: '-0.02em',
                lineHeight: 1.15,
              }}
            >
              Quiet. Safe. Electric.
            </h2>

            {/* Single Crisp 1-Line Spec Underneath */}
            <div
              style={{
                fontFamily: '"IBM Plex Mono", monospace',
                fontSize: '12px',
                fontWeight: 700,
                color: '#2E6F5E',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                minHeight: '24px',
              }}
            >
              <span
                style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  backgroundColor: '#2E6F5E',
                  boxShadow: '0 0 6px #2E6F5E',
                  flexShrink: 0,
                }}
              />
              <span>
                {activeSubsystem === '01'
                  ? 'All-day battery • Zero emissions'
                  : activeSubsystem === '02'
                  ? 'Silent 20 km/h campus motor'
                  : activeSubsystem === '03'
                  ? 'Soft suspension for speed bumps'
                  : 'All-day battery • Zero emissions'}
              </span>
            </div>

            {/* Final CTA Button */}
            <div style={{ paddingTop: '6px' }}>
              <button
                type="button"
                onClick={onBookPass}
                style={{
                  backgroundColor: '#10B981',
                  color: '#0B1116',
                  border: '1px solid #10B981',
                  boxShadow: '0 4px 14px rgba(16, 185, 129, 0.25), 3px 3px 0px #0D1013',
                  borderRadius: '8px',
                  padding: '13px 22px',
                  fontSize: '13px',
                  fontWeight: 900,
                  letterSpacing: '0.04em',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = '#34D399';
                  e.currentTarget.style.boxShadow = '0 6px 20px rgba(16, 185, 129, 0.4), 3px 3px 0px #0D1013';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = '#10B981';
                  e.currentTarget.style.boxShadow = '0 4px 14px rgba(16, 185, 129, 0.25), 3px 3px 0px #0D1013';
                }}
                onMouseDown={(e) => (e.currentTarget.style.transform = 'translate(1px, 1px)')}
                onMouseUp={(e) => (e.currentTarget.style.transform = 'translate(0, 0)')}
              >
                <span>Get Your Monthly Pass →</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* -------------------------------------------------------- */}
      {/* VIRTUAL SCROLL ANCHOR                                    */}
      {/* -------------------------------------------------------- */}
      <div ref={scrollContainerRef} style={{ height: '400vh', pointerEvents: 'none' }} />
    </div>
  );
}
