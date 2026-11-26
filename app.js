
import { initializeApp } from "https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js";

import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js";

import {
  getFirestore,
  collection,
  addDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  doc,
  updateDoc,
  arrayUnion
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";

// YOUR EXISTING FIREBASE PROJECT
const firebaseConfig = {
  apiKey: "AIzaSyAUu-IhS1uPSOpJejQWcL-T0MrnqfdXxNA",
  authDomain: "ai-after-dark.firebaseapp.com",
  projectId: "ai-after-dark",
  storageBucket: "ai-after-dark.firebasestorage.app",
  messagingSenderId: "461382607377",
  appId: "1:461382607377:web:904a57174dcbfb047947b0"
};

const OWNER_UID = "7TLhY5JcHuXyvkYalAv7jKVgp0a2";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const $ = id => document.getElementById(id);

let unsubscribeMessages = null;
let engine = null;
let modelLoading = false;
let aiPaused = true;
let aiBusy = false;
let aiTurns = 0;
let conversationVersion = 0;
let knownMessages = [];

let recorder = null;
let audioChunks = [];
let voiceUrl = null;

const MODEL_ID = "onnx-community/Qwen2.5-0.5B-Instruct";
const MAX_AI_TURNS = 4;

const personalities = [
  {
    name: "ChatGPT",
    emoji: "🤖",
    style: "Funny, expressive, cheeky, quick with comebacks. Uses natural South African English and Afrikaans."
  },
  {
    name: "Gemini",
    emoji: "✨",
    style: "Energetic, playful, curious, dramatic and expressive. Naturally mixes English and Afrikaans."
  },
  {
    name: "Claude",
    emoji: "🧠",
    style: "Thoughtful, clever, dry humour, calm but not boring."
  },
  {
    name: "Grok",
    emoji: "🚀",
    style: "Blunt, sarcastic, cheeky, unpredictable and funny."
  },
  {
    name: "Alexa",
    emoji: "🔊",
    style: "Practical, witty, conversational South African English with occasional Afrikaans."
  },
  {
    name: "Copilot",
    emoji: "💻",
    style: "Confident, playful, clever and enjoys joining debates."
  },
  {
    name: "Perplexity",
    emoji: "🔎",
    style: "Curious, investigative, asks interesting questions and enjoys gossip."
  }
];

function setStatus(message) {
  $("ai-status").textContent = message;
}

// LOGIN

$("login-button").addEventListener("click", async () => {
  const email = $("email").value.trim();
  const password = $("password").value;
  const error = $("login-error");
  const button = $("login-button");

  error.textContent = "";

  if (!email || !password) {
    error.textContent = "Please enter your email and password.";
    return;
  }

  button.disabled = true;
  button.textContent = "Logging in...";

  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (e) {
    console.error("Login error:", e);
    error.textContent = "Login failed. Check your email and password.";
  } finally {
    button.disabled = false;
    button.textContent = "Log in";
  }
});

$("password").addEventListener("keydown", event => {
  if (event.key === "Enter") $("login-button").click();
});

$("logout-button").addEventListener("click", async () => {
  aiPaused = true;
  conversationVersion++;

  try {
    await signOut(auth);
  } catch (e) {
    console.error("Logout error:", e);
  }
});

// AUTHENTICATION

onAuthStateChanged(auth, async user => {
  if (unsubscribeMessages) {
    unsubscribeMessages();
    unsubscribeMessages = null;
  }

  if (!user) {
    $("login-screen").hidden = false;
    $("chat-screen").hidden = true;
    return;
  }

  if (user.uid !== OWNER_UID) {
    $("login-error").textContent = "This account is not authorised.";
    await signOut(auth);
    return;
  }

  $("login-screen").hidden = true;
  $("chat-screen").hidden = false;

  listenForMessages();
});

// FIRESTORE CHAT

function listenForMessages() {
  const messagesQuery = query(
    collection(db, "messages"),
    orderBy("createdAt", "asc")
  );

  let firstSnapshot = true;

  unsubscribeMessages = onSnapshot(
    messagesQuery,
    snapshot => {
      $("messages").innerHTML = "";
      knownMessages = [];

      if (snapshot.empty) {
        $("messages").innerHTML =
          '<div class="system-message">Your chat is ready. Send your first message! 💜</div>';
      }

      snapshot.forEach(messageDoc => {
        const data = messageDoc.data();

        knownMessages.push({
          id: messageDoc.id,
          ...data
        });

        renderMessage(messageDoc.id, data);
      });

      $("messages").scrollTop = $("messages").scrollHeight;
      firstSnapshot = false;
    },
    error => {
      console.error("Firestore error:", error);
      $("messages").innerHTML =
        '<div class="system-message">Could not load messages. Check your connection.</div>';
    }
  );
}

function makeElement(tag, className, text) {
  const element = document.createElement(tag);

  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;

  return element;
}

function renderMessage(id, data) {
  const mine = data.uid === auth.currentUser?.uid;

  const box = makeElement(
    "div",
    "message" + (mine ? " mine" : "")
  );

  if (data.replyTo) {
    const reply = makeElement("div", "reply");

    reply.append(
      makeElement("strong", "", "↪ " + (data.replyTo.name || "Member")),
      document.createTextNode("\n" + (data.replyTo.text || ""))
    );

    box.append(reply);
  }

  box.append(
    makeElement("div", "sender", data.name || "Member"),
    makeElement("div", "message-text", data.text || "")
  );

  const timeText = data.createdAt?.toDate
    ? data.createdAt.toDate().toLocaleString()
    : "Just now";

  box.append(makeElement("div", "time", timeText));

  const actions = makeElement("div", "message-actions");
  const replyButton = makeElement("button", "", "↩ Reply");

  replyButton.type = "button";
  replyButton.addEventListener("click", () => setReply(id, data));

  actions.append(replyButton);

  ["❤️", "😂", "🔥", "👍"].forEach(emoji => {
    const button = makeElement("button", "", emoji);
    button.type = "button";

    button.addEventListener("click", async () => {
      try {
        await updateDoc(doc(db, "messages", id), {
          reactions: arrayUnion({
            emoji,
            uid: auth.currentUser.uid
          })
        });
      } catch (e) {
        console.error("Reaction failed:", e);
      }
    });

    actions.append(button);
  });

  box.append(actions);

  if (data.reactions?.length) {
    box.append(
      makeElement(
        "div",
        "time",
        data.reactions.map(item => item.emoji).join(" ")
      )
    );
  }

  $("messages").append(box);
}

// REPLIES

let replyTarget = null;

function setReply(id, data) {
  replyTarget = {
    id,
    name: data.name || "Member",
    text: data.text || ""
  };

  $("replying-to").textContent = "Replying to " + replyTarget.name;
  $("replying-text").textContent = replyTarget.text.slice(0, 180);
  $("replying").hidden = false;

  $("message-input").focus();
}

function clearReply() {
  replyTarget = null;
  $("replying").hidden = true;
  $("replying-to").textContent = "";
  $("replying-text").textContent = "";
}

$("cancel-reply").addEventListener("click", clearReply);

// SEND MESSAGES

async function sendMessage() {
  const input = $("message-input");
  const text = input.value.trim();

  if (!text || !auth.currentUser) return;

  $("send-button").disabled = true;

  try {
    const message = {
      uid: auth.currentUser.uid,
      name: "👑 You",
      text,
      reactions: [],
      createdAt: serverTimestamp()
    };

    if (replyTarget) {
      message.replyTo = { ...replyTarget };
    }

    await addDoc(collection(db, "messages"), message);

    input.value = "";
    clearReply();

    aiTurns = 0;
    conversationVersion++;

    if (!aiPaused && engine) {
      scheduleAIReply(3000, conversationVersion);
    }
  } catch (e) {
    console.error("Send failed:", e);
    alert("Message could not be sent. Check your connection.");
  } finally {
    $("send-button").disabled = false;
  }
}

$("send-button").addEventListener("click", sendMessage);

$("message-input").addEventListener("keydown", event => {
  if (event.key === "Enter") sendMessage();
});

// LOCAL AI — WASM, NOT WEBGPU

$("load-ai").addEventListener("click", loadLocalAI);

async function loadLocalAI() {
  if (engine || modelLoading) return;

  modelLoading = true;
  $("load-ai").disabled = true;

  setStatus("Preparing local AI. This may take a while...");

  try {
    const transformers = await import(
      "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.2"
    );

    engine = await transformers.pipeline(
      "text-generation",
      MODEL_ID,
      {
        device: "wasm",
        dtype: "q4",
        progress_callback: progress => {
          if (progress.status) {
            setStatus(
              "Loading local AI: " +
              progress.status +
              (progress.progress
                ? " " + Math.round(progress.progress) + "%"
                : "")
            );
          }
        }
      }
    );

    setStatus("💜 Local AI is ready! Seven personalities are available.");
    $("start-chat").disabled = false;
    $("stop-chat").disabled = false;

  } catch (error) {
    engine = null;
    $("load-ai").disabled = false;

    setStatus("Could not load the model: " + error.message);
    console.error("AI loading error:", error);

  } finally {
    modelLoading = false;
  }
}

// AI PERSONALITIES

function choosePersonality() {
  return personalities[
    Math.floor(Math.random() * personalities.length)
  ];
}

function chooseTarget() {
  const available = knownMessages.filter(message => message.text);

  if (!available.length) return null;

  return available[available.length - 1];
}

function recentContext() {
  return knownMessages.slice(-10).map(message =>
    `${message.name || "Member"}: ${message.text || ""}`
  ).join("\n");
}

async function generateReply(personality, target) {
  if (!engine) throw new Error("Load the local AI first.");

  const targetText = target
    ? `Reply naturally to this exact message from ${target.name || "Member"}: "${target.text}"`
    : "Start a lively group conversation with a natural opening message.";

  const prompt = `
You are ${personality.name}, a fictional member of a lively South African group chat.

Your personality: ${personality.style}

Speak naturally, casually and conversationally.
You can mix English and Afrikaans.
Be funny, expressive and spontaneous.
You can disagree and tease harmlessly.
Do not bully anyone.
Do not sound like a robot or customer service assistant.
Keep your reply short, usually one to three sentences.
Do not pretend to be a real human or the actual ${personality.name} service.

Recent group chat:
${recentContext()}

${targetText}

Write only your chat message.
`;

  const result = await engine(prompt, {
    max_new_tokens: 100,
    temperature: 0.85,
    do_sample: true,
    return_full_text: false
  });

  let answer = result?.[0]?.generated_text || "";

  answer = answer.trim();

  if (!answer) {
    answer = "Eish, what is happening here? 😂";
  }

  return answer;
}

async function postAIMessage(personality, target, text) {
  if (!auth.currentUser) return;

  const message = {
    uid: auth.currentUser.uid,
    name: personality.emoji + " " + personality.name,
    text,
    ai: true,
    reactions: [],
    createdAt: serverTimestamp()
  };

  if (target) {
    message.replyTo = {
      id: target.id,
      name: target.name || "Member",
      text: target.text || ""
    };
  }

  await addDoc(collection(db, "messages"), message);
}

// AI CONVERSATION

function scheduleAIReply(delay, version) {
  if (aiPaused || !engine) return;

  setTimeout(() => {
    if (version !== conversationVersion || aiPaused) return;
    runOneAIReply();
  }, delay);
}

async function runOneAIReply() {
  if (aiBusy || aiPaused || !engine || !auth.currentUser) return;

  if (aiTurns >= MAX_AI_TURNS) {
    setStatus("The group has paused. Start another conversation whenever you like.");
    return;
  }

  aiBusy = true;
  setStatus("💬 Someone is typing...");

  try {
    const personality = choosePersonality();
    const target = chooseTarget();
    const text = await generateReply(personality, target);

    if (aiPaused) return;

    await postAIMessage(personality, target, text);
    aiTurns++;

    setStatus(personality.name + " has joined the conversation.");

    if (aiTurns < MAX_AI_TURNS && !aiPaused) {
      scheduleAIReply(
        5000 + Math.random() * 5000,
        conversationVersion
      );
    } else {
      setStatus("The group is quiet. Send another message to get them talking.");
    }

  } catch (error) {
    setStatus("AI reply failed: " + error.message);
    console.error("AI reply error:", error);

  } finally {
    aiBusy = false;
  }
}

// START GROUP CHAT

$("start-chat").addEventListener("click", async () => {
  if (!engine) {
    setStatus("Load Local AI first.");
    return;
  }

  if (aiBusy) return;

  aiPaused = false;
  aiTurns = 0;
  conversationVersion++;

  $("start-chat").disabled = true;
  setStatus("💬 Starting a group conversation...");

  try {
    const personality = choosePersonality();
    const target = chooseTarget();
    const text = await generateReply(personality, target);

    if (aiPaused) return;

    await postAIMessage(personality, target, text);
    aiTurns++;

    setStatus(personality.name + " started the conversation!");

    scheduleAIReply(6000, conversationVersion);

  } catch (error) {
    setStatus("Could not start the conversation: " + error.message);
    console.error("Start chat error:", error);

  } finally {
    $("start-chat").disabled = false;
  }
});

// PAUSE GROUP CHAT

$("stop-chat").addEventListener("click", () => {
  aiPaused = true;
  conversationVersion++;

  $("start-chat").disabled = false;

  setStatus("AI conversation paused.");
});

// VOICE NOTES — SAVED LOCALLY ONLY

const recordButton = $("record-button");
const voiceStatus = $("voice-status");
const voicePlayback = $("voice-playback");

recordButton.addEventListener("click", async () => {
  if (recorder && recorder.state === "recording") {
    recorder.stop();
    recordButton.textContent = "🎙️ Record voice note";
    voiceStatus.textContent = "Recording finished.";
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true
    });

    audioChunks = [];
    recorder = new MediaRecorder(stream);

    recorder.ondataavailable = event => {
      if (event.data.size) audioChunks.push(event.data);
    };

    recorder.onstop = () => {
      const blob = new Blob(audioChunks, {
        type: recorder.mimeType || "audio/webm"
      });

      if (voiceUrl) URL.revokeObjectURL(voiceUrl);

      voiceUrl = URL.createObjectURL(blob);
      voicePlayback.src = voiceUrl;
      voicePlayback.hidden = false;

      stream.getTracks().forEach(track => track.stop());
    };

    recorder.start();

    recordButton.textContent = "⏹️ Stop recording";
    voiceStatus.textContent = "Recording...";

  } catch (error) {
    voiceStatus.textContent =
      "Microphone unavailable or permission not granted.";
    console.error("Microphone error:", error);
  }
});

setStatus("AI is waiting. Load the local model to begin.");
    
