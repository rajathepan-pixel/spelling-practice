const setup = document.querySelector("#setup");
const quiz = document.querySelector("#quiz");
const results = document.querySelector("#results");
const profilePanel = document.querySelector("#profile-panel");
const profileSelect = document.querySelector("#profile-select");
const profileMessage = document.querySelector("#profile-message");
const profileProgress = document.querySelector("#profile-progress");
const languageSelect = document.querySelector("#language");
const wordList = document.querySelector("#word-list");
const forestMap = document.querySelector("#forest-map");
const setupMessage = document.querySelector("#setup-message");
const answerForm = document.querySelector("#answer-form");
const answerInput = document.querySelector("#answer");
const answerFeedback = document.querySelector("#answer-feedback");
const progress = document.querySelector("#progress");
const scoreDisplay = document.querySelector("#score");
const submitButton = document.querySelector("#submit-button");
const voiceStatus = document.querySelector("#voice-status");
const reviewMissedButton = document.querySelector("#review-missed-button");

const STORAGE_KEY = "spelling-practice-profiles-v1";
const FOREST_LEVELS = [
  { name: "Whispering Woods", icon: "🌲" },
  { name: "Pebble Path", icon: "🪨" },
  { name: "Mushroom Meadow", icon: "🍄" },
  { name: "Bramble Bridge", icon: "🌿" },
  { name: "Moonlit Hollow", icon: "🌙" },
];
const FOREST_MONSTERS = [
  { name: "Mossy Muncher", art: "👾" },
  { name: "Wiggly Worm", art: "🐛" },
  { name: "Grumpy Mushroom", art: "🍄" },
  { name: "Bramble Beast", art: "🐻" },
  { name: "Bouncy Bog Blob", art: "🟢" },
];
const BADGE_DEFINITIONS = {
  firstQuiz: "First quiz",
  streakFive: "5-word streak",
  perfectQuiz: "Perfect quiz",
};
let profiles = [];
let currentProfileId = "";
let storageAvailable = true;
let quizWords = [];
let correctCount = 0;
let correctByLanguage = { "en-US": 0, "fr-FR": 0 };
let language = "en-US";
let submitted = false;
let speechRequest = 0;
let currentStreak = 0;
let sessionXp = 0;
let isReviewRound = false;
let sessionBadges = [];
let battleQueue = [];
let activeWord = null;
let defeatedCount = 0;
let currentLevel = 1;
let selectedLevel = 1;

function loadProfiles() {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const data = JSON.parse(saved);
      const validWord = (word) =>
        word &&
        typeof word.text === "string" &&
        (word.language === "en-US" || word.language === "fr-FR");
      const validProfile = (profile) =>
        profile &&
        typeof profile.id === "string" &&
        typeof profile.name === "string" &&
        Number.isFinite(profile.xp) &&
        Array.isArray(profile.badges) &&
        Array.isArray(profile.missedWords) &&
        profile.missedWords.every(validWord) &&
        Array.isArray(profile.attemptedWords) &&
        profile.attemptedWords.every((key) => typeof key === "string") &&
        (!profile.wordBank || (Array.isArray(profile.wordBank) && profile.wordBank.every(validWord))) &&
        Number.isFinite(profile.quizzesCompleted) &&
        Number.isFinite(profile.bestStreak);
      if (
        !Array.isArray(data.profiles) ||
        !data.profiles.every(validProfile) ||
        typeof data.currentProfileId !== "string"
      ) {
        throw new Error("Saved profile data has an invalid format.");
      }
      profiles = data.profiles;
      profiles.forEach((profile) => {
        if (!Number.isInteger(profile.highestForestLevel) || profile.highestForestLevel < 1) {
          profile.highestForestLevel = 1;
        }
        if (!Array.isArray(profile.clearedForestLevels)) {
          profile.clearedForestLevels = [];
        }
        if (!Array.isArray(profile.wordBank)) {
          profile.wordBank = [];
        }
      });
      currentProfileId = data.currentProfileId;
      if (!profiles.some((profile) => profile.id === currentProfileId)) {
        currentProfileId = profiles.length ? profiles[0].id : "";
      }
    }
  } catch (error) {
    storageAvailable = false;
    profileMessage.textContent = `Could not load saved profiles: ${error.message}`;
  }
}

function saveProfiles() {
  if (!storageAvailable) {
    return;
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ profiles, currentProfileId }));
    profileMessage.textContent = "";
  } catch (error) {
    storageAvailable = false;
    profileMessage.textContent = `Progress could not be saved on this device: ${error.message}`;
  }
}

function activeProfile() {
  return profiles.find((profile) => profile.id === currentProfileId) || null;
}

function createProfile(name) {
  const profile = {
    id: `profile-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name,
    xp: 0,
    badges: [],
    missedWords: [],
    attemptedWords: [],
    wordBank: [],
    highestForestLevel: 1,
    clearedForestLevels: [],
    quizzesCompleted: 0,
    bestStreak: 0,
  };
  profiles.push(profile);
  currentProfileId = profile.id;
  saveProfiles();
  renderProfiles();
}

function awardBadge(badgeId, newlyEarned) {
  const profile = activeProfile();
  if (profile && !profile.badges.includes(badgeId)) {
    profile.badges.push(badgeId);
    newlyEarned.push(BADGE_DEFINITIONS[badgeId]);
  }
}

function loadSpeechVoices() {
  const synthesis = window.speechSynthesis;
  const availableVoices = synthesis.getVoices();
  if (availableVoices.length) {
    return Promise.resolve(availableVoices);
  }

  return new Promise((resolve) => {
    let resolved = false;
    const finish = () => {
      if (resolved) {
        return;
      }

      const voices = synthesis.getVoices();
      if (voices.length) {
        resolved = true;
        synthesis.removeEventListener("voiceschanged", finish);
        window.clearTimeout(timeout);
        resolve(voices);
      }
    };

    const timeout = window.setTimeout(() => {
      if (!resolved) {
        finish();
        if (!resolved) {
          resolved = true;
          synthesis.removeEventListener("voiceschanged", finish);
          resolve(synthesis.getVoices());
        }
      }
    }, 1500);

    synthesis.addEventListener("voiceschanged", finish);
  });
}

function shuffled(items) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const otherIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[otherIndex]] = [result[otherIndex], result[index]];
  }
  return result;
}

function parseWordList(value, defaultLanguage) {
  return value
    .split(/\r?\n/)
    .map((line) => {
      const entry = line.trim();
      const taggedWord = /^(en|fr)\s*:\s*(\S.*)$/i.exec(entry);

      if (taggedWord) {
        return {
          text: taggedWord[2].trim(),
          language: taggedWord[1].toLowerCase() === "fr" ? "fr-FR" : "en-US",
        };
      }

      return entry ? { text: entry, language: defaultLanguage } : null;
    })
    .filter((word) => word !== null);
}

async function speakCurrentWord() {
  if (!("speechSynthesis" in window)) {
    voiceStatus.textContent = "Speech is not available in this browser.";
    return;
  }

  const request = ++speechRequest;
  window.speechSynthesis.cancel();
  voiceStatus.textContent = "";
  const voices = await loadSpeechVoices();
  if (request !== speechRequest || quiz.hidden) {
    return;
  }

  const currentWord = activeWord;
  if (!currentWord) {
    return;
  }
  const languagePrefix = currentWord.language.split("-")[0].toLowerCase();
  const matchingVoices = voices.filter((voice) =>
    voice.lang.toLowerCase().startsWith(`${languagePrefix}-`) ||
    voice.lang.toLowerCase() === languagePrefix
  );
  const voice = matchingVoices.find((candidate) =>
    candidate.lang.toLowerCase() === currentWord.language.toLowerCase()
  ) || matchingVoices[0];

  if (!voice) {
    const languageName = currentWord.language === "fr-FR" ? "French" : "English";
    voiceStatus.textContent = voices.length
      ? `No ${languageName} speech voice is available. Install or enable one in your device's speech settings.`
      : "No speech voices are available. Check your device's speech settings.";
    return;
  }

  const utterance = new SpeechSynthesisUtterance(currentWord.text);
  utterance.lang = currentWord.language;
  utterance.voice = voice;
  utterance.onerror = (event) => {
    if (event.error !== "canceled" && event.error !== "interrupted") {
      voiceStatus.textContent = "The selected speech voice could not play this word.";
    }
  };
  window.speechSynthesis.speak(utterance);
}

function normalizeSpelling(value, wordLanguage) {
  return value.trim().normalize("NFC").toLocaleLowerCase(wordLanguage);
}

function wordKey(word) {
  return `${word.language}:${normalizeSpelling(word.text, word.language)}`;
}

function showQuestion() {
  activeWord = battleQueue[0];
  if (!activeWord) {
    showResults();
    return;
  }
  submitted = false;
  answerInput.value = "";
  answerInput.disabled = false;
  answerFeedback.textContent = "";
  answerFeedback.className = "feedback";
  submitButton.textContent = "Spell the word";
  progress.textContent = `${FOREST_LEVELS[currentLevel - 1].name} · Monsters defeated: ${defeatedCount} / ${quizWords.length}`;
  scoreDisplay.textContent = `First-try words: ${correctCount} · Streak: ${currentStreak} · XP: ${sessionXp}`;
  const monster = FOREST_MONSTERS[(activeWord.encounterIndex + currentLevel - 1) % FOREST_MONSTERS.length];
  document.querySelector("#monster-art").textContent = monster.art;
  document.querySelector("#monster-name").textContent = monster.name;
  document.querySelector("#monster-health").textContent =
    activeWord.mistakes.length ? "Still bouncing! Try again later." : "Ready to battle!";
  document.querySelector("#prompt-label").textContent =
    "Spell the word to defeat the monster!";
  answerInput.focus();
  speakCurrentWord();
}

function showForestMap() {
  const profile = activeProfile();
  if (!profile) {
    setupMessage.textContent = "Create or choose a learner profile first.";
    return;
  }

  language = languageSelect.value;
  const list = parseWordList(wordList.value, language);
  if (list.length === 0) {
    setupMessage.textContent = "Enter at least one word to explore the forest.";
    return;
  }

  setupMessage.textContent = "";
  profile.wordBank = list.map((word) => ({ text: word.text, language: word.language }));
  saveProfiles();
  renderForestMap();
  setup.hidden = true;
  forestMap.hidden = false;
}

function renderForestMap() {
  const profile = activeProfile();
  const levelList = document.querySelector("#forest-levels");
  levelList.replaceChildren();
  if (!profile) {
    return;
  }

  const clearedLevels = new Set(profile.clearedForestLevels);
  selectedLevel = Math.min(
    Math.max(selectedLevel, 1),
    Math.min(profile.highestForestLevel, FOREST_LEVELS.length)
  );
  document.querySelector("#map-intro").textContent =
    `Spark has ${profile.wordBank.length} word${profile.wordBank.length === 1 ? "" : "s"} to practice. Spell each one to defeat a silly monster. Your word list follows Spark into every new forest area.`;

  FOREST_LEVELS.forEach((level, index) => {
    const levelNumber = index + 1;
    const unlocked = levelNumber <= profile.highestForestLevel;
    const item = unlocked ? document.createElement("button") : document.createElement("div");
    item.className = `forest-level${levelNumber === selectedLevel ? " selected" : ""}`;
    if (unlocked) {
      item.type = "button";
      item.setAttribute("aria-pressed", String(levelNumber === selectedLevel));
      item.addEventListener("click", () => {
        selectedLevel = levelNumber;
        renderForestMap();
      });
    } else {
      item.setAttribute("aria-disabled", "true");
    }
    const icon = document.createElement("span");
    icon.className = "level-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = unlocked ? level.icon : "🔒";
    const copy = document.createElement("span");
    copy.className = "forest-level-copy";
    const title = document.createElement("strong");
    title.textContent = `Level ${levelNumber}: ${level.name}`;
    const status = document.createElement("span");
    status.textContent = clearedLevels.has(levelNumber)
      ? "Forest cleared!"
      : unlocked
        ? "Ready to explore"
        : "Defeat every monster in the previous level to unlock";
    copy.append(title, status);
    item.append(icon, copy);
    levelList.append(item);
  });

  const startLevelButton = document.querySelector("#start-level-button");
  startLevelButton.disabled = profile.wordBank.length === 0;
  startLevelButton.textContent = `Enter Level ${selectedLevel}: ${FOREST_LEVELS[selectedLevel - 1].name}`;
}

function startQuiz(review = false) {
  const profile = activeProfile();
  const source = review
    ? profile?.missedWords.map((word) => ({ text: word.text, language: word.language }))
    : profile?.wordBank.map((word) => ({ ...word }));
  if (!profile || !source || source.length === 0) {
    profileMessage.textContent = review
      ? "There are no missed words to review."
      : "Add a profile and word list before starting.";
    return;
  }

  isReviewRound = review;
  currentLevel = selectedLevel;
  quizWords = shuffled(source).map((word, index) => ({
    ...word,
    id: `${word.language}:${word.text}:${index}`,
    encounterIndex: index,
    answer: "",
    isCorrect: false,
    firstTryCorrect: null,
    mistakes: [],
    defeated: false,
    tries: 0,
  }));
  battleQueue = [...quizWords];
  correctCount = 0;
  correctByLanguage = { "en-US": 0, "fr-FR": 0 };
  currentStreak = 0;
  sessionXp = 0;
  sessionBadges = [];
  defeatedCount = 0;
  activeWord = null;
  profilePanel.hidden = true;
  setup.hidden = true;
  forestMap.hidden = true;
  results.hidden = true;
  quiz.hidden = false;
  showQuestion();
}

function renderAnswerReview() {
  const correctList = document.querySelector("#correct-words");
  const incorrectList = document.querySelector("#incorrect-words");
  correctList.replaceChildren();
  incorrectList.replaceChildren();

  quizWords.forEach((word) => {
    const item = document.createElement("li");
    const languageName = word.language === "fr-FR" ? "Français" : "English";

    if (word.firstTryCorrect) {
      item.textContent = `${word.text} (${languageName})`;
      correctList.append(item);
      return;
    }

    const label = document.createElement("span");
    label.textContent = `${languageName} — `;
    const correction = document.createElement("span");
    correction.textContent = `Correct spelling: ${word.text}`;
    const answer = document.createElement("span");
    answer.className = "misspelled-answer";
    answer.textContent = `Your answer: ${word.mistakes[0] || "(not correct on the first try)"}`;
    item.append(label, correction, document.createElement("br"), answer);
    incorrectList.append(item);
  });

  if (correctList.childElementCount === 0) {
    const emptyMessage = document.createElement("li");
    emptyMessage.className = "empty-review";
    emptyMessage.textContent = "No words spelled correctly this time.";
    correctList.append(emptyMessage);
  }

  if (incorrectList.childElementCount === 0) {
    const emptyMessage = document.createElement("li");
    emptyMessage.className = "empty-review";
    emptyMessage.textContent = "No first-try mistakes. Great work!";
    incorrectList.append(emptyMessage);
  }
}

function showResults() {
  speechRequest += 1;
  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
  quiz.hidden = true;
  results.hidden = false;
  profilePanel.hidden = false;
  document.querySelector("#results-eyebrow").textContent =
    isReviewRound ? "Review complete" : "Forest level complete";
  document.querySelector("#results-heading").textContent =
    isReviewRound
      ? `${correctCount} out of ${quizWords.length} review words spelled correctly on the first try`
      : `${FOREST_LEVELS[currentLevel - 1].name} cleared!`;
  const totalByLanguage = quizWords.reduce((totals, word) => {
    totals[word.language] += 1;
    return totals;
  }, { "en-US": 0, "fr-FR": 0 });
  document.querySelector("#english-result").textContent =
    `${correctByLanguage["en-US"]} out of ${totalByLanguage["en-US"]} English words correct on the first try`;
  document.querySelector("#french-result").textContent =
    `${correctByLanguage["fr-FR"]} out of ${totalByLanguage["fr-FR"]} French words correct on the first try`;
  document.querySelector("#results-detail").textContent =
    correctCount === quizWords.length
      ? "Perfect spelling! Every monster was defeated without a first-try mistake."
      : `Spark defeated all ${quizWords.length} monsters. You needed another try on ${quizWords.length - correctCount} word${quizWords.length - correctCount === 1 ? "" : "s"}. See your first-try mistakes below.`;

  const profile = activeProfile();
  const newlyEarned = [...sessionBadges];
  let unlockMessage = "Review complete. Keep practicing with Spark!";
  if (!isReviewRound && profile) {
    profile.quizzesCompleted += 1;
    if (!profile.clearedForestLevels.includes(currentLevel)) {
      profile.clearedForestLevels.push(currentLevel);
    }
    if (currentLevel < FOREST_LEVELS.length && profile.highestForestLevel === currentLevel) {
      profile.highestForestLevel += 1;
      unlockMessage = `Level ${profile.highestForestLevel} unlocked: ${FOREST_LEVELS[profile.highestForestLevel - 1].name}!`;
    } else if (currentLevel === FOREST_LEVELS.length) {
      unlockMessage = "Spark explored the whole forest! You can replay any forest level.";
    } else {
      unlockMessage = "Level cleared! You can replay this trail or explore the next one.";
    }
    awardBadge("firstQuiz", newlyEarned);
    if (correctCount === quizWords.length) {
      awardBadge("perfectQuiz", newlyEarned);
    }
  }
  document.querySelector("#forest-unlock").textContent = unlockMessage;

  const badgeMessage = newlyEarned.length ? ` New badge: ${newlyEarned.join(", ")}!` : "";
  document.querySelector("#xp-earned").textContent =
    isReviewRound
      ? `Review complete. No XP is awarded for review attempts.${badgeMessage}`
      : `You earned ${sessionXp} XP this quiz.${badgeMessage}`;
  reviewMissedButton.hidden = !profile || profile.missedWords.length === 0;
  document.querySelector("#map-button").textContent = "Explore the forest";
  renderAnswerReview();
  renderProfiles();
  saveProfiles();
}

function renderProfiles() {
  profileSelect.replaceChildren();
  profiles.forEach((profile) => {
    const option = document.createElement("option");
    option.value = profile.id;
    option.textContent = profile.name;
    profileSelect.append(option);
  });
  profileSelect.value = currentProfileId;

  const profile = activeProfile();
  document.querySelector("#delete-profile-button").disabled = !profile;
  profileProgress.hidden = !profile;
  document.querySelector("#start-button").disabled = !profile || !storageAvailable;
  reviewMissedButton.hidden = !profile || profile.missedWords.length === 0;

  if (!profile) {
    document.querySelector("#profile-xp").textContent = "0 XP";
    document.querySelector("#profile-review-count").textContent = "0 words to review";
    document.querySelector("#profile-badges").replaceChildren();
    return;
  }

  document.querySelector("#profile-xp").textContent = `${profile.xp} XP`;
  document.querySelector("#profile-review-count").textContent =
    `${profile.missedWords.length} ${profile.missedWords.length === 1 ? "word" : "words"} to review`;
  const badgeList = document.querySelector("#profile-badges");
  badgeList.replaceChildren();
  const earnedBadges = profile.badges.map((badgeId) => BADGE_DEFINITIONS[badgeId]).filter(Boolean);
  if (earnedBadges.length === 0) {
    const emptyBadge = document.createElement("li");
    emptyBadge.className = "empty-badges";
    emptyBadge.textContent = "Your first badge is waiting.";
    badgeList.append(emptyBadge);
    return;
  }
  earnedBadges.forEach((badgeName) => {
    const badge = document.createElement("li");
    badge.textContent = badgeName;
    badgeList.append(badge);
  });
}

function updateMissedWords(word, isCorrect) {
  const profile = activeProfile();
  if (!profile) {
    return;
  }
  const key = wordKey(word);
  const savedIndex = profile.missedWords.findIndex((savedWord) => wordKey(savedWord) === key);
  if (isCorrect) {
    if (savedIndex !== -1) {
      profile.missedWords.splice(savedIndex, 1);
    }
  } else if (savedIndex === -1) {
    profile.missedWords.push({ text: word.text, language: word.language, answer: word.answer });
  } else {
    profile.missedWords[savedIndex].answer = word.answer;
  }
}

document.querySelector("#create-profile-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const nameInput = document.querySelector("#new-profile-name");
  const name = nameInput.value.trim();
  if (!name) {
    profileMessage.textContent = "Enter a name for the profile.";
    return;
  }
  if (profiles.some((profile) => profile.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
    profileMessage.textContent = "A profile with that name already exists.";
    return;
  }
  createProfile(name);
  nameInput.value = "";
  setupMessage.textContent = "";
});

profileSelect.addEventListener("change", () => {
  currentProfileId = profileSelect.value;
  selectedLevel = 1;
  const profile = activeProfile();
  wordList.value = (profile?.wordBank || [])
    .map((word) => `${word.language === "fr-FR" ? "fr" : "en"}: ${word.text}`)
    .join("\n");
  saveProfiles();
  renderProfiles();
  renderForestMap();
});

document.querySelector("#delete-profile-button").addEventListener("click", () => {
  const profile = activeProfile();
  if (!profile || !window.confirm(`Delete ${profile.name}'s profile and all saved progress?`)) {
    return;
  }
  profiles = profiles.filter((candidate) => candidate.id !== profile.id);
  currentProfileId = profiles.length ? profiles[0].id : "";
  const selectedProfile = activeProfile();
  wordList.value = (selectedProfile?.wordBank || [])
    .map((word) => `${word.language === "fr-FR" ? "fr" : "en"}: ${word.text}`)
    .join("\n");
  saveProfiles();
  renderProfiles();
  renderForestMap();
});

loadProfiles();
if (storageAvailable) {
  renderProfiles();
  const profile = activeProfile();
  wordList.value = (profile?.wordBank || [])
    .map((word) => `${word.language === "fr-FR" ? "fr" : "en"}: ${word.text}`)
    .join("\n");
} else {
  document.querySelector("#start-button").disabled = true;
  document.querySelector("#delete-profile-button").disabled = true;
}

document.querySelector("#start-button").addEventListener("click", showForestMap);
document.querySelector("#start-level-button").addEventListener("click", () => startQuiz());
document.querySelector("#replay-button").addEventListener("click", speakCurrentWord);
reviewMissedButton.addEventListener("click", () => startQuiz(true));
document.querySelector("#change-words-button").addEventListener("click", () => {
  forestMap.hidden = true;
  setup.hidden = false;
});
document.querySelector("#map-button").addEventListener("click", () => {
  results.hidden = true;
  renderForestMap();
  forestMap.hidden = false;
});

answerForm.addEventListener("submit", (event) => {
  event.preventDefault();

  if (submitted) {
    battleQueue.shift();
    if (activeWord && !activeWord.defeated) {
      battleQueue.push(activeWord);
    }
    if (battleQueue.length === 0) {
      showResults();
    } else {
      showQuestion();
    }
    return;
  }

  const expected = activeWord;
  const isCorrect =
    normalizeSpelling(answerInput.value, expected.language) ===
    normalizeSpelling(expected.text, expected.language);
  const enteredAnswer = answerInput.value.trim();
  expected.tries += 1;
  const firstTry = expected.tries === 1;
  const profile = activeProfile();
  let firstAttempt = false;
  if (!isReviewRound && profile) {
    const key = wordKey(expected);
    firstAttempt = !profile.attemptedWords.includes(key);
    if (firstAttempt) {
      profile.attemptedWords.push(key);
    }
  }
  if (isCorrect) {
    expected.defeated = true;
    expected.isCorrect = true;
    defeatedCount += 1;
    if (firstTry) {
      expected.firstTryCorrect = true;
      expected.answer = enteredAnswer;
      correctCount += 1;
      correctByLanguage[expected.language] += 1;
    }
    if (!isReviewRound && profile && firstAttempt && firstTry) {
      currentStreak += 1;
      let earned = 10;
      if (currentStreak % 3 === 0) {
        earned += 5;
      }
      profile.xp += earned;
      sessionXp += earned;
      profile.bestStreak = Math.max(profile.bestStreak, currentStreak);
      if (currentStreak >= 5) {
        awardBadge("streakFive", sessionBadges);
      }
    }
    updateMissedWords(expected, true);
    answerFeedback.textContent = firstTry
      ? `Correct! Spark defeated the monster with “${expected.text}”!`
      : `That’s it! Spark defeated the monster with “${expected.text}”.`;
    answerFeedback.className = "feedback correct";
    document.querySelector("#monster-health").textContent = "Monster defeated!";
  } else {
    if (firstTry) {
      expected.firstTryCorrect = false;
      expected.answer = enteredAnswer;
    }
    expected.mistakes.push(enteredAnswer || "(no answer)");
    currentStreak = 0;
    updateMissedWords(expected, false);
    answerFeedback.textContent =
      `Oops! The correct spelling is “${expected.text}”. Spark will bring this monster back for another try.`;
    answerFeedback.className = "feedback incorrect";
    document.querySelector("#monster-health").textContent = "Not defeated yet!";
  }

  saveProfiles();
  renderProfiles();
  submitted = true;
  answerInput.disabled = true;
  submitButton.textContent = "Continue adventure";
  progress.textContent =
    `${FOREST_LEVELS[currentLevel - 1].name} · Monsters defeated: ${defeatedCount} / ${quizWords.length}`;
  scoreDisplay.textContent = `First-try words: ${correctCount} · Streak: ${currentStreak} · XP: ${sessionXp}`;
  submitButton.focus();
});

document.querySelector("#edit-list-button").addEventListener("click", () => {
  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
  results.hidden = true;
  setup.hidden = false;
  profilePanel.hidden = false;
  setupMessage.textContent = "";
  wordList.focus();
});
