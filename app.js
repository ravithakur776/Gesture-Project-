const videoEl = document.getElementById("input-video");
const canvasEl = document.getElementById("output-canvas");
const ctx = canvasEl.getContext("2d");

const gestureValueEl = document.getElementById("gesture-value");
const confidenceValueEl = document.getElementById("confidence-value");
const actionValueEl = document.getElementById("action-value");
const handsCountEl = document.getElementById("hands-count");
const fpsValueEl = document.getElementById("fps-value");
const samplesCountEl = document.getElementById("samples-count");
const slideIndexEl = document.getElementById("slide-index");
const recordingStateEl = document.getElementById("recording-state");
const activeModeLabelEl = document.getElementById("active-mode-label");
const dominantGestureEl = document.getElementById("dominant-gesture");
const gestureBarsEl = document.getElementById("gesture-bars");
const gestureBurstEl = document.getElementById("gesture-burst");
const sessionDurationEl = document.getElementById("session-duration");
const timelineListEl = document.getElementById("timeline-list");
const trailIntensityEl = document.getElementById("trail-intensity");
const statusTextEl = document.getElementById("status-text");

const startBtn = document.getElementById("start-btn");
const stopBtn = document.getElementById("stop-btn");
const recordBtn = document.getElementById("record-btn");
const calibrateBtn = document.getElementById("calibrate-btn");
const captureBtn = document.getElementById("capture-btn");
const exportJsonBtn = document.getElementById("export-json-btn");
const exportCsvBtn = document.getElementById("export-csv-btn");

const palette = {
  cyan: "#41ffd6",
  pink: "#ff5ec8",
  blue: "#5ea5ff",
  amber: "#ffd165",
  white: "#ffffff",
  green: "#9cff6e",
};

const fingerTips = [4, 8, 12, 16, 20];
const commandMap = {
  "Swipe Left": "Previous",
  "Swipe Right": "Next",
  Pinch: "Keyframe",
  Fist: "Marker",
  Peace: "Highlight",
  "Open Palm": "Ready",
  Point: "Pointer",
};

const trails = new Map();
const wristMotion = new Map();
const swipeCooldown = new Map();
const session = {
  startedAt: null,
  endedAt: null,
  samples: [],
  events: [],
  captures: [],
  gestureCounts: {},
  calibration: null,
};

let detector = null;
let stream = null;
let animationFrame = 0;
let running = false;
let recording = false;
let sendingFrame = false;
let trackingReady = false;
let renderMode = "neon";
let appMode = "presenter";
let trailLength = Number(trailIntensityEl.value);
let latestFrame = { hands: [] };
let lastFrameTime = performance.now();
let lastSampleAt = 0;
let lastEventAt = 0;
let lastGestureName = "No hands";
let burstTimer = 0;
let slideIndex = 1;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function setStatus(message, isError = false) {
  statusTextEl.textContent = message;
  statusTextEl.dataset.state = isError ? "error" : "ok";
}

function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function tokenNow() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function fingerExtended(landmarks, tipIdx, pipIdx) {
  return landmarks[tipIdx].y < landmarks[pipIdx].y - 0.02;
}

function thumbExtended(landmarks, handLabel) {
  const delta = landmarks[4].x - landmarks[3].x;
  return handLabel === "Right" ? delta < -0.015 : delta > 0.015;
}

function detectSwipe(handIndex, wristX) {
  const now = performance.now();
  const history = wristMotion.get(handIndex) || [];
  history.push({ x: wristX, t: now });

  while (history.length && now - history[0].t > 420) {
    history.shift();
  }

  wristMotion.set(handIndex, history);

  if (history.length < 4) {
    return null;
  }

  const dx = history[history.length - 1].x - history[0].x;
  const cooldownUntil = swipeCooldown.get(handIndex) || 0;
  if (Math.abs(dx) > 0.17 && now > cooldownUntil) {
    swipeCooldown.set(handIndex, now + 650);
    return {
      name: dx > 0 ? "Swipe Right" : "Swipe Left",
      confidence: clamp(Math.abs(dx) / 0.35, 0.62, 0.95),
    };
  }

  return null;
}

function detectGesture(landmarks, handLabel, handIndex) {
  const thumb = thumbExtended(landmarks, handLabel);
  const index = fingerExtended(landmarks, 8, 6);
  const middle = fingerExtended(landmarks, 12, 10);
  const ring = fingerExtended(landmarks, 16, 14);
  const pinky = fingerExtended(landmarks, 20, 18);
  const pinchDist = distance(landmarks[4], landmarks[8]);

  if (pinchDist < 0.065) {
    return {
      name: "Pinch",
      confidence: clamp(1 - pinchDist / 0.08, 0.65, 0.98),
    };
  }

  const swipe = detectSwipe(handIndex, landmarks[0].x);
  if (swipe) {
    return swipe;
  }

  if (thumb && index && middle && ring && pinky) {
    return { name: "Open Palm", confidence: 0.88 };
  }

  if (!index && !middle && !ring && !pinky && !thumb) {
    return { name: "Fist", confidence: 0.86 };
  }

  if (index && middle && !ring && !pinky) {
    return { name: "Peace", confidence: 0.84 };
  }

  if (index && !middle && !ring && !pinky) {
    return { name: "Point", confidence: 0.8 };
  }

  return { name: "Tracking", confidence: 0.55 };
}

function sizeCanvasToVideo() {
  const width = videoEl.videoWidth || 1280;
  const height = videoEl.videoHeight || 720;

  if (canvasEl.width !== width || canvasEl.height !== height) {
    canvasEl.width = width;
    canvasEl.height = height;
  }
}

function drawMirroredVideo(source) {
  sizeCanvasToVideo();
  ctx.save();
  ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
  ctx.translate(canvasEl.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(source, 0, 0, canvasEl.width, canvasEl.height);

  if (renderMode !== "debug") {
    ctx.fillStyle = "rgba(5, 7, 10, 0.12)";
    ctx.fillRect(0, 0, canvasEl.width, canvasEl.height);
  }
}

function finishMirroredDraw() {
  ctx.restore();
}

function drawTrail(points, color) {
  if (points.length < 2 || renderMode === "clean" || trailLength === 0) {
    return;
  }

  for (let i = 1; i < points.length; i += 1) {
    const alpha = i / points.length;
    ctx.strokeStyle = `${color}${Math.floor(alpha * 230)
      .toString(16)
      .padStart(2, "0")}`;
    ctx.lineWidth = 1.2 + alpha * 4;
    ctx.beginPath();
    ctx.moveTo(points[i - 1].x, points[i - 1].y);
    ctx.lineTo(points[i].x, points[i].y);
    ctx.stroke();
  }
}

function updateFingerTrails(landmarks, handIndex) {
  const colors = [palette.cyan, palette.pink, palette.blue, palette.amber, palette.white];
  fingerTips.forEach((tipId, i) => {
    const key = `${handIndex}-${tipId}`;
    const point = {
      x: landmarks[tipId].x * canvasEl.width,
      y: landmarks[tipId].y * canvasEl.height,
    };
    const list = trails.get(key) || [];
    list.push(point);

    while (list.length > trailLength) {
      list.shift();
    }

    trails.set(key, list);
    drawTrail(list, colors[(handIndex + i) % colors.length]);
  });
}

function drawHandSkeleton(landmarks, handIndex) {
  const connections = window.HAND_CONNECTIONS || [];
  const color = handIndex % 2 === 0 ? palette.cyan : palette.pink;

  ctx.shadowBlur = renderMode === "neon" ? 16 : 0;
  ctx.shadowColor = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = renderMode === "debug" ? 1.4 : 2.2;

  for (const pair of connections) {
    const start = landmarks[pair[0]];
    const end = landmarks[pair[1]];
    ctx.beginPath();
    ctx.moveTo(start.x * canvasEl.width, start.y * canvasEl.height);
    ctx.lineTo(end.x * canvasEl.width, end.y * canvasEl.height);
    ctx.stroke();
  }

  ctx.shadowBlur = renderMode === "neon" ? 10 : 0;
  landmarks.forEach((point, pointIndex) => {
    const x = point.x * canvasEl.width;
    const y = point.y * canvasEl.height;
    const radius = renderMode === "debug" ? 2.3 : pointIndex % 4 === 0 ? 4 : 3;
    ctx.fillStyle = pointIndex % 4 === 0 ? palette.amber : color;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();

    if (renderMode === "debug") {
      ctx.fillStyle = palette.white;
      ctx.font = "10px monospace";
      ctx.fillText(String(pointIndex), x + 5, y - 5);
    }
  });
  ctx.shadowBlur = 0;
}

function drawPointer(landmarks) {
  if (appMode !== "presenter" || !landmarks) {
    return;
  }

  const tip = landmarks[8];
  const x = tip.x * canvasEl.width;
  const y = tip.y * canvasEl.height;

  ctx.strokeStyle = palette.amber;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, 22, 0, Math.PI * 2);
  ctx.stroke();
}

function drawIdle(message = "Start Camera") {
  ctx.fillStyle = "#05070a";
  ctx.fillRect(0, 0, canvasEl.width, canvasEl.height);
  ctx.fillStyle = "rgba(255,255,255,0.94)";
  ctx.font = "700 38px 'Bricolage Grotesque', sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(message, canvasEl.width / 2, canvasEl.height / 2 - 10);
  ctx.fillStyle = "rgba(168,176,186,0.9)";
  ctx.font = "500 18px 'Space Grotesk', sans-serif";
  ctx.fillText("Local webcam capture console", canvasEl.width / 2, canvasEl.height / 2 + 28);
}

function updateFrameRate() {
  const now = performance.now();
  const dt = now - lastFrameTime;
  if (dt > 0) {
    fpsValueEl.textContent = Math.round(1000 / dt).toString();
  }
  lastFrameTime = now;
}

function addTimelineEvent(type, gesture, action) {
  const event = {
    type,
    gesture,
    action,
    mode: appMode,
    timestamp: new Date().toISOString(),
    sessionMs: session.startedAt ? Math.round(performance.now() - session.startedAt) : 0,
  };
  session.events.push(event);

  const row = document.createElement("div");
  row.className = "timeline-event";
  row.innerHTML = `<span>${formatDuration(event.sessionMs)}</span><strong>${gesture}</strong><em>${action}</em>`;

  if (timelineListEl.querySelector(".empty-state")) {
    timelineListEl.innerHTML = "";
  }
  timelineListEl.prepend(row);

  while (timelineListEl.children.length > 8) {
    timelineListEl.lastElementChild.remove();
  }
}

function pulseGesture(gesture) {
  gestureBurstEl.textContent = gesture;
  gestureBurstEl.classList.remove("show");
  requestAnimationFrame(() => gestureBurstEl.classList.add("show"));
  window.clearTimeout(burstTimer);
  burstTimer = window.setTimeout(() => gestureBurstEl.classList.remove("show"), 900);
}

function handleGestureAction(gestureName, confidence) {
  const now = performance.now();
  const action = commandMap[gestureName] || "Tracking";
  actionValueEl.textContent = action;

  if (gestureName === "No hands" || gestureName === "Tracking" || confidence < 0.7) {
    return;
  }

  const repeated = gestureName === lastGestureName && now - lastEventAt < 900;
  if (repeated) {
    return;
  }

  lastGestureName = gestureName;
  lastEventAt = now;
  session.gestureCounts[gestureName] = (session.gestureCounts[gestureName] || 0) + 1;

  if (appMode === "presenter") {
    if (gestureName === "Swipe Right") {
      slideIndex += 1;
    }
    if (gestureName === "Swipe Left") {
      slideIndex = Math.max(1, slideIndex - 1);
    }
    slideIndexEl.textContent = String(slideIndex);
  }

  if (recording || ["Swipe Left", "Swipe Right", "Pinch", "Fist", "Peace"].includes(gestureName)) {
    addTimelineEvent("gesture", gestureName, action);
  }

  pulseGesture(action);
  renderGestureBars();
}

function sanitizeLandmarks(landmarks) {
  return landmarks.map((point) => ({
    x: Number(point.x.toFixed(6)),
    y: Number(point.y.toFixed(6)),
    z: Number(point.z.toFixed(6)),
  }));
}

function updateGestureDisplay(landmarksList, handedness, worldLandmarks) {
  const gestures = landmarksList.map((landmarks, handIndex) => {
    const handLabel = handedness[handIndex]?.label || "Unknown";
    return detectGesture(landmarks, handLabel, handIndex);
  });

  const best = gestures.sort((a, b) => b.confidence - a.confidence)[0];
  const gestureName = best?.name || "No hands";
  const confidence = best?.confidence || 0;

  handsCountEl.textContent = landmarksList.length.toString();
  gestureValueEl.textContent = gestureName;
  confidenceValueEl.textContent = `${Math.round(confidence * 100)}%`;

  latestFrame = {
    timestamp: new Date().toISOString(),
    gesture: gestureName,
    confidence,
    hands: landmarksList.map((landmarks, index) => ({
      handedness: handedness[index]?.label || "Unknown",
      landmarks: sanitizeLandmarks(landmarks),
      worldLandmarks: sanitizeLandmarks(worldLandmarks[index] || []),
    })),
  };

  handleGestureAction(gestureName, confidence);
  recordSample();
}

function recordSample() {
  if (!recording || !latestFrame.hands.length) {
    return;
  }

  const now = performance.now();
  if (now - lastSampleAt < 250) {
    return;
  }

  lastSampleAt = now;
  session.samples.push({
    sessionMs: session.startedAt ? Math.round(now - session.startedAt) : 0,
    ...latestFrame,
  });
  samplesCountEl.textContent = String(session.samples.length);
}

function renderGestureBars() {
  const entries = Object.entries(session.gestureCounts).sort((a, b) => b[1] - a[1]);
  dominantGestureEl.textContent = entries[0]?.[0] || "None";
  gestureBarsEl.innerHTML = "";

  const max = Math.max(...entries.map(([, count]) => count), 1);
  entries.slice(0, 5).forEach(([gesture, count]) => {
    const bar = document.createElement("div");
    bar.className = "gesture-bar";
    bar.innerHTML = `<span>${gesture}</span><strong>${count}</strong><i style="width:${(count / max) * 100}%"></i>`;
    gestureBarsEl.appendChild(bar);
  });
}

function updateSessionTimer() {
  if (!recording || !session.startedAt) {
    return;
  }

  sessionDurationEl.textContent = formatDuration(performance.now() - session.startedAt);
}

function onResults(results) {
  if (!running || !results.image) {
    return;
  }

  updateFrameRate();
  drawMirroredVideo(results.image);

  const handedness = results.multiHandedness || [];
  const landmarksList = results.multiHandLandmarks || [];
  const worldLandmarks = results.multiHandWorldLandmarks || [];

  landmarksList.forEach((landmarks, handIndex) => {
    updateFingerTrails(landmarks, handIndex);
    drawHandSkeleton(landmarks, handIndex);
    drawPointer(landmarks);
  });

  finishMirroredDraw();
  updateGestureDisplay(landmarksList, handedness, worldLandmarks);
  updateSessionTimer();
}

function drawPreviewOnly() {
  if (!running || videoEl.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    return;
  }

  updateFrameRate();
  drawMirroredVideo(videoEl);
  finishMirroredDraw();
  updateSessionTimer();
}

async function setupDetector() {
  if (!window.Hands || !window.HAND_CONNECTIONS) {
    throw new Error("Hand tracking library is unavailable.");
  }

  detector = new window.Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
  });

  detector.setOptions({
    maxNumHands: 2,
    modelComplexity: 1,
    minDetectionConfidence: 0.72,
    minTrackingConfidence: 0.62,
  });
  detector.onResults(onResults);
  trackingReady = true;
}

async function processFrame() {
  if (!running) {
    return;
  }

  if (!trackingReady || !detector) {
    drawPreviewOnly();
    animationFrame = requestAnimationFrame(processFrame);
    return;
  }

  if (!sendingFrame && videoEl.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    sendingFrame = true;
    try {
      await detector.send({ image: videoEl });
    } catch (error) {
      trackingReady = false;
      setStatus("Camera is live. Hand tracking failed to load from the network.", true);
      drawPreviewOnly();
    } finally {
      sendingFrame = false;
    }
  }

  animationFrame = requestAnimationFrame(processFrame);
}

function getCameraErrorMessage(error) {
  if (!window.isSecureContext && location.protocol !== "http:") {
    return "Camera requires localhost or HTTPS. Use http://127.0.0.1:8081.";
  }

  if (error?.name === "NotAllowedError") {
    return "Camera permission was blocked. Allow camera access in the browser, then try again.";
  }

  if (error?.name === "NotFoundError") {
    return "No camera was found on this device.";
  }

  if (error?.name === "NotReadableError") {
    return "The camera is already in use by another app.";
  }

  return error instanceof Error ? error.message : "Unable to start the camera.";
}

async function startCamera() {
  if (running) {
    setStatus("Camera already running.");
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus("This browser does not support camera capture.", true);
    return;
  }

  try {
    setStatus("Requesting camera permission...");
    startBtn.disabled = true;

    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: "user",
      },
    });

    videoEl.srcObject = stream;
    await videoEl.play();
    sizeCanvasToVideo();

    running = true;
    stopBtn.disabled = false;
    trails.clear();
    wristMotion.clear();
    swipeCooldown.clear();

    setStatus("Camera live. Loading hand tracking...");
    drawPreviewOnly();

    try {
      await setupDetector();
      setStatus("Camera and hand tracking are active.");
    } catch (error) {
      trackingReady = false;
      setStatus("Camera is live. Hand tracking needs internet access to load.", true);
    }

    processFrame();
  } catch (error) {
    startBtn.disabled = false;
    stopBtn.disabled = true;
    setStatus(getCameraErrorMessage(error), true);
  }
}

function stopCamera() {
  if (!running && !stream) {
    setStatus("Camera already stopped.");
    return;
  }

  cancelAnimationFrame(animationFrame);
  animationFrame = 0;

  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
  }

  videoEl.srcObject = null;
  stream = null;
  running = false;
  sendingFrame = false;
  trackingReady = false;

  startBtn.disabled = false;
  stopBtn.disabled = true;
  trails.clear();
  wristMotion.clear();
  swipeCooldown.clear();

  gestureValueEl.textContent = "Waiting...";
  confidenceValueEl.textContent = "0%";
  actionValueEl.textContent = "Idle";
  handsCountEl.textContent = "0";
  fpsValueEl.textContent = "0";
  drawIdle();
  setStatus("Camera stopped.");
}

function toggleRecording() {
  if (!running) {
    setStatus("Start the camera before recording a session.", true);
    return;
  }

  recording = !recording;

  if (recording) {
    session.startedAt = performance.now();
    session.endedAt = null;
    recordBtn.textContent = "Pause";
    recordingStateEl.textContent = "Recording";
    setStatus("Recording session data.");
    addTimelineEvent("session", "Session", "Recording");
    return;
  }

  session.endedAt = performance.now();
  recordBtn.textContent = "Record";
  recordingStateEl.textContent = "Paused";
  setStatus("Recording paused.");
  addTimelineEvent("session", "Session", "Paused");
}

function calibrate() {
  if (!latestFrame.hands.length) {
    setStatus("Show one hand clearly, then calibrate.", true);
    return;
  }

  const primary = latestFrame.hands[0].landmarks;
  const wrist = primary[0];
  const middleTip = primary[12];
  session.calibration = {
    timestamp: new Date().toISOString(),
    handSpan: Number(distance(wrist, middleTip).toFixed(6)),
    handedness: latestFrame.hands[0].handedness,
  };
  addTimelineEvent("calibration", "Calibration", "Saved");
  setStatus("Calibration saved for this session.");
}

function captureFrame() {
  if (!running) {
    setStatus("Start camera first, then capture frame.", true);
    return;
  }

  canvasEl.toBlob((blob) => {
    if (!blob) {
      setStatus("Could not capture frame.", true);
      return;
    }

    const filename = `gesture-frame-${tokenNow()}.png`;
    session.captures.push({
      filename,
      timestamp: new Date().toISOString(),
      gesture: latestFrame.gesture || "Unknown",
    });
    addTimelineEvent("capture", latestFrame.gesture || "Frame", "PNG");
    triggerDownload(blob, filename);
    setStatus("Frame captured.");
  }, "image/png");
}

function buildSessionExport() {
  const duration = session.startedAt
    ? Math.round((session.endedAt || performance.now()) - session.startedAt)
    : 0;

  return {
    app: "GestureOS Studio",
    version: "1.0.0",
    exportedAt: new Date().toISOString(),
    mode: appMode,
    renderMode,
    durationMs: duration,
    slideIndex,
    gestureCounts: session.gestureCounts,
    calibration: session.calibration,
    captures: session.captures,
    events: session.events,
    samples: session.samples,
    latestFrame,
  };
}

function exportJson() {
  const blob = new Blob([JSON.stringify(buildSessionExport(), null, 2)], {
    type: "application/json",
  });
  triggerDownload(blob, `gesture-session-${tokenNow()}.json`);
  setStatus("Session JSON exported.");
}

function exportCsv() {
  const rows = [
    ["timestamp", "sessionMs", "type", "gesture", "action", "mode"],
    ...session.events.map((event) => [
      event.timestamp,
      event.sessionMs,
      event.type,
      event.gesture,
      event.action,
      event.mode,
    ]),
  ];

  const csv = rows
    .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  triggerDownload(blob, `gesture-events-${tokenNow()}.csv`);
  setStatus("Event CSV exported.");
}

function setAppMode(mode) {
  appMode = mode;
  activeModeLabelEl.textContent = mode.charAt(0).toUpperCase() + mode.slice(1);
  document.querySelectorAll(".mode-btn").forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === mode);
  });
  addTimelineEvent("mode", "Mode", activeModeLabelEl.textContent);
}

function setRenderMode(mode) {
  renderMode = mode;
  document.querySelectorAll(".segment").forEach((button) => {
    button.classList.toggle("active", button.dataset.render === mode);
  });
}

function updateModeLabel() {
  const label = renderMode.charAt(0).toUpperCase() + renderMode.slice(1);
  actionValueEl.textContent = commandMap[latestFrame.gesture] || "Idle";
  document.documentElement.style.setProperty("--trail-strength", String(trailLength));
  return label;
}

startBtn.addEventListener("click", startCamera);
stopBtn.addEventListener("click", stopCamera);
recordBtn.addEventListener("click", toggleRecording);
calibrateBtn.addEventListener("click", calibrate);
captureBtn.addEventListener("click", captureFrame);
exportJsonBtn.addEventListener("click", exportJson);
exportCsvBtn.addEventListener("click", exportCsv);

trailIntensityEl.addEventListener("input", (event) => {
  trailLength = Number(event.target.value);
  updateModeLabel();
});

document.querySelectorAll(".mode-btn").forEach((button) => {
  button.addEventListener("click", () => setAppMode(button.dataset.mode));
});

document.querySelectorAll(".segment").forEach((button) => {
  button.addEventListener("click", () => setRenderMode(button.dataset.render));
});

document.addEventListener("keydown", (event) => {
  if (event.code === "Space") {
    event.preventDefault();
    captureFrame();
  }

  if (event.key.toLowerCase() === "r") {
    toggleRecording();
  }
});

window.addEventListener("beforeunload", () => {
  if (running || stream) {
    stopCamera();
  }
});

stopBtn.disabled = true;
samplesCountEl.textContent = "0";
renderGestureBars();
drawIdle();
