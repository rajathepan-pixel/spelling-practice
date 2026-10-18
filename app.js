const setup = document.querySelector("#setup");
const quiz = document.querySelector("#quiz");
const results = document.querySelector("#results");
const profilePanel = document.querySelector("#profile-panel");
const profileSelect = document.querySelector("#profile-select");
const profileMessage = document.querySelector("#profile-message");
const profileProgress = document.querySelector("#profile-progress");
const languageSelect = document.querySelector("#language");
const wordList = document.querySelector("#word-list");
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
const BADGE_DEFINITIONS = {
  firstQuiz: "First quiz",
  streakFive: "5-word streak",
  perfectQuiz: "Perfect quiz",
};
let profiles = [];
let currentProfileId = "";
let storageAvailable = true;
let quizWords = [];
let currentIndex = 0;
let correctCount = 0;
let correctByLanguage = { "en-US": 0, "fr-FR": 0 };
let language = "en-US";
let submitted = false;
let speechRequest = 0;
let currentStreak = 0;
let sessionXp = 0;
let isReviewRound = false;
let sessionBadges = [];

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

  const currentWord = quizWords[currentIndex];
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
  submitted = false;
  answerInput.value = "";
  answerInput.disabled = false;
  answerFeedback.textContent = "";
  answerFeedback.className = "feedback";
  submitButton.textContent = "Check spelling";
  progress.textContent = `${isReviewRound ? "Review" : "Word"} ${currentIndex + 1} of ${quizWords.length}`;
  scoreDisplay.textContent = `Correct: ${correctCount} · Streak: ${currentStreak} · XP this quiz: ${sessionXp}`;
  answerInput.focus();
  speakCurrentWord();
}

function startQuiz(review = false) {
  const profile = activeProfile();
  if (!profile) {
    setupMessage.textContent = "Create or choose a learner profile first.";
    return;
  }

  language = languageSelect.value;
  const list = review
    ? profile.missedWords.map((word) => ({ ...word }))
    : parseWordList(wordList.value, language);

  if (list.length === 0) {
    setupMessage.textContent = review
      ? "There are no missed words to review."
      : "Enter at least one word to start.";
    return;
  }

  setupMessage.textContent = "";
  isReviewRound = review;
  quizWords = shuffled(list);
  currentIndex = 0;
  correctCount = 0;
  correctByLanguage = { "en-US": 0, "fr-FR": 0 };
  currentStreak = 0;
  sessionXp = 0;
  sessionBadges = [];
  profilePanel.hidden = true;
  setup.hidden = true;
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

    if (word.isCorrect) {
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
    answer.textContent = `Your answer: ${word.answer || "(no answer)"}`;
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
    emptyMessage.textContent = "No words to practice. Great work!";
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
  document.querySelector("#results-heading").textContent =
    `${correctCount} out of ${quizWords.length} words spelled correctly`;
  const totalByLanguage = quizWords.reduce((totals, word) => {
    totals[word.language] += 1;
    return totals;
  }, { "en-US": 0, "fr-FR": 0 });
  document.querySelector("#english-result").textContent =
    `${correctByLanguage["en-US"]} out of ${totalByLanguage["en-US"]} English words spelled correctly`;
  document.querySelector("#french-result").textContent =
    `${correctByLanguage["fr-FR"]} out of ${totalByLanguage["fr-FR"]} French words spelled correctly`;
  document.querySelector("#results-detail").textContent =
    correctCount === quizWords.length
      ? "Perfect score. Nicely done!"
      : "Keep practicing. You can shuffle the same list and try again.";

  const profile = activeProfile();
  const newlyEarned = [...sessionBadges];
  if (!isReviewRound && profile) {
    profile.quizzesCompleted += 1;
    awardBadge("firstQuiz", newlyEarned);
    if (correctCount === quizWords.length) {
      awardBadge("perfectQuiz", newlyEarned);
    }
  }

  const badgeMessage = newlyEarned.length ? ` New badge: ${newlyEarned.join(", ")}!` : "";
  document.querySelector("#xp-earned").textContent =
    isReviewRound
      ? `Review complete. No XP is awarded for review attempts.${badgeMessage}`
      : `You earned ${sessionXp} XP this quiz.${badgeMessage}`;
  reviewMissedButton.hidden = !profile || profile.missedWords.length === 0;
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
  saveProfiles();
  renderProfiles();
});

document.querySelector("#delete-profile-button").addEventListener("click", () => {
  const profile = activeProfile();
  if (!profile || !window.confirm(`Delete ${profile.name}'s profile and all saved progress?`)) {
    return;
  }
  profiles = profiles.filter((candidate) => candidate.id !== profile.id);
  currentProfileId = profiles.length ? profiles[0].id : "";
  saveProfiles();
  renderProfiles();
});

loadProfiles();
if (storageAvailable) {
  renderProfiles();
} else {
  document.querySelector("#start-button").disabled = true;
  document.querySelector("#delete-profile-button").disabled = true;
}

document.querySelector("#start-button").addEventListener("click", () => startQuiz());
document.querySelector("#replay-button").addEventListener("click", speakCurrentWord);
reviewMissedButton.addEventListener("click", () => startQuiz(true));

answerForm.addEventListener("submit", (event) => {
  event.preventDefault();

  if (submitted) {
    currentIndex += 1;
    if (currentIndex === quizWords.length) {
      showResults();
    } else {
      showQuestion();
    }
    return;
  }

  const expected = quizWords[currentIndex];
  const isCorrect =
    normalizeSpelling(answerInput.value, expected.language) ===
    normalizeSpelling(expected.text, expected.language);
  expected.answer = answerInput.value.trim();
  expected.isCorrect = isCorrect;
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
    correctCount += 1;
    correctByLanguage[expected.language] += 1;
    currentStreak += 1;
    if (!isReviewRound && profile && firstAttempt) {
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
    answerFeedback.textContent = `Correct! The word is “${expected.text}”.`;
    answerFeedback.className = "feedback correct";
  } else {
    currentStreak = 0;
    updateMissedWords(expected, false);
    answerFeedback.textContent = `Not quite. The correct spelling is “${expected.text}”.`;
    answerFeedback.className = "feedback incorrect";
  }

  saveProfiles();
  renderProfiles();
  submitted = true;
  answerInput.disabled = true;
  submitButton.textContent = currentIndex + 1 === quizWords.length ? "See results" : "Next word";
  scoreDisplay.textContent = `Correct: ${correctCount} · Streak: ${currentStreak} · XP this quiz: ${sessionXp}`;
  submitButton.focus();
});

document.querySelector("#restart-button").addEventListener("click", () => startQuiz());
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
