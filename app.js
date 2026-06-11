/**
 * 多語言離線翻譯器 - 完整版 (手動翻譯按鈕 + 強化清除標點)
 * 支援模式: 一般(中英雙向)、旅遊日語(中日雙向)、旅遊韓語(中韓雙向)
 * 詞庫: data/zh_en_dual.json, data/zh_ja_dual.json, data/zh_ko_dual.json
 * 旅遊句子: data/travel_ja.json, data/travel_ko.json
 * 語音輸入: Web Speech API (中文)
 */

// ----------------------------- 全域變數 -----------------------------
let currentMode = 'general';       // 'general', 'japanese', 'korean'

// 詞典結構 (單一 dual 物件)
let dictGeneral = { dual: {} };
let dictJapanese = { dual: {} };
let dictKorean = { dual: {} };

// 旅遊句子列表
let travelJaList = [];
let travelKoList = [];

// 自訂詞彙 (每個模式獨立)
let customDict = {
    general: { forward: {}, backward: {} },
    japanese: { forward: {}, backward: {} },
    korean: { forward: {}, backward: {} }
};

// 當前模式的作用中映射
let activeForwardMap = {};
let activeBackwardMap = {};

// 語音辨識物件
let recognition = null;
let isRecognizing = false;

// 載入狀態
let isLoading = true;

// DOM 元素
const inputTextarea = document.getElementById('inputText');
const outputDiv = document.getElementById('outputText');
const clearBtn = document.getElementById('clearBtn');
const addWordBtn = document.getElementById('addWordBtn');
const resetCustomBtn = document.getElementById('resetCustomBtn');
const speakResultBtn = document.getElementById('speakResultBtn');
const voiceInputBtn = document.getElementById('voiceInputBtn');
const voiceStopBtn = document.getElementById('voiceStopBtn');
const translateBtn = document.getElementById('translateBtn');
const voiceStatusSpan = document.getElementById('voiceStatus');
const modeBtns = document.querySelectorAll('.mode-btn');
const langHintSpan = document.getElementById('langHint');
const travelPhrasesDiv = document.getElementById('travelPhrasesList');

// ----------------------------- 輔助函數 -----------------------------
function cleanText(text) {
    // 去除前後空格，並移除常見標點符號（保留中日韓英字母數字、空格）
    let cleaned = text.trim();
    // 移除標點：。，！？；：""''（）【】《》…—・、,.!?;:()[]{}<> 
    cleaned = cleaned.replace(/[。，！？；：""''（）【】《》…—・、,\.!\?;:\(\)\[\]\{\}<>]/g, '');
    // 將多個連續空格縮為一個
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    return cleaned;
}

async function loadJSON(url, fallback = null) {
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
    } catch (err) {
        console.warn(`載入 ${url} 失敗:`, err);
        return fallback;
    }
}

// 初始化載入所有詞庫 + 旅遊句子
async function loadAllDictionaries() {
    console.log("開始載入詞庫...");
    
    const generalDual = await loadJSON('data/zh_en_dual.json', {});
    dictGeneral.dual = generalDual;
    console.log("中英詞庫條目數:", Object.keys(generalDual).length);

    const japaneseDual = await loadJSON('data/zh_ja_dual.json', {});
    dictJapanese.dual = japaneseDual;
    console.log("中日詞庫條目數:", Object.keys(japaneseDual).length);

    const koreanDual = await loadJSON('data/zh_ko_dual.json', {});
    dictKorean.dual = koreanDual;
    console.log("中韓詞庫條目數:", Object.keys(koreanDual).length);

    const travelJaRaw = await loadJSON('data/travel_ja.json', {});
    travelJaList = convertTravelObjectToArray(travelJaRaw, 'ja');
    const travelKoRaw = await loadJSON('data/travel_ko.json', {});
    travelKoList = convertTravelObjectToArray(travelKoRaw, 'ko');

    loadCustomFromStorage();
    rebuildActiveMaps();
    isLoading = false;
    updateTravelPhrasesUI();
    if (inputTextarea.value.trim() !== "") {
        performTranslation();
    } else {
        outputDiv.innerHTML = "✨ 離線詞庫已就緒，可開始翻譯或點選旅遊句子";
    }
}

function convertTravelObjectToArray(obj, langKey) {
    const arr = [];
    for (const [zh, target] of Object.entries(obj)) {
        arr.push({ zh, target });
    }
    return arr;
}

function loadCustomFromStorage() {
    const modes = ['general', 'japanese', 'korean'];
    for (let mode of modes) {
        const stored = localStorage.getItem(`customDict_${mode}`);
        if (stored) {
            try {
                const parsed = JSON.parse(stored);
                customDict[mode] = parsed;
            } catch(e) { console.warn(e); }
        } else {
            customDict[mode] = { forward: {}, backward: {} };
        }
    }
}

function saveCurrentCustom() {
    const toStore = customDict[currentMode];
    localStorage.setItem(`customDict_${currentMode}`, JSON.stringify(toStore));
}

function rebuildActiveMaps() {
    let baseForward = {};
    let baseBackward = {};
    
    if (currentMode === 'general') {
        baseForward = { ...dictGeneral.dual };
        for (const [k, v] of Object.entries(baseForward)) {
            baseBackward[v] = k;
        }
    } 
    else if (currentMode === 'japanese') {
        baseForward = { ...dictJapanese.dual };
        for (const [k, v] of Object.entries(baseForward)) {
            baseBackward[v] = k;
        }
    } 
    else if (currentMode === 'korean') {
        baseForward = { ...dictKorean.dual };
        for (const [k, v] of Object.entries(baseForward)) {
            baseBackward[v] = k;
        }
    }
    
    const customF = customDict[currentMode].forward || {};
    const customB = customDict[currentMode].backward || {};
    
    activeForwardMap = { ...baseForward, ...customF };
    activeBackwardMap = { ...baseBackward, ...customB };
    
    // 確保自訂詞彙反向同步
    for (const [src, tgt] of Object.entries(customF)) {
        if (!activeBackwardMap[tgt]) activeBackwardMap[tgt] = src;
    }
    for (const [tgt, src] of Object.entries(customB)) {
        if (!activeForwardMap[src]) activeForwardMap[src] = tgt;
    }
    
    // 更新介面提示
    if (currentMode === 'general') langHintSpan.innerText = '模式: 中英雙向';
    else if (currentMode === 'japanese') langHintSpan.innerText = '模式: 中日雙向 (旅日)';
    else langHintSpan.innerText = '模式: 中韓雙向 (旅韓)';
}

function translateWithLongestMatch(rawText, forwardMap, backwardMap) {
    let cleaned = cleanText(rawText);
    if (cleaned === "") return "";
    
    // 1. 全句精確匹配
    let lowerInput = cleaned.toLowerCase();
    for (let [src, tgt] of Object.entries(forwardMap)) {
        if (src.toLowerCase() === lowerInput) return tgt;
    }
    for (let [tgtSrc, orig] of Object.entries(backwardMap)) {
        if (tgtSrc.toLowerCase() === lowerInput) return orig;
    }
    
    // 2. 單詞 / 分詞匹配
    const words = cleaned.split(/\s+/);
    if (words.length === 1) {
        const single = words[0].toLowerCase();
        if (forwardMap[single]) return forwardMap[single];
        if (backwardMap[single]) return backwardMap[single];
        return "⚠️ 未收錄此詞彙，可使用下方「自訂詞彙」添加";
    } 
    else {
        let translatedParts = [];
        let unknownCount = 0;
        for (let w of words) {
            const lowerW = w.toLowerCase();
            if (forwardMap[lowerW]) translatedParts.push(forwardMap[lowerW]);
            else if (backwardMap[lowerW]) translatedParts.push(backwardMap[lowerW]);
            else {
                translatedParts.push(w);
                unknownCount++;
            }
        }
        if (unknownCount === words.length) {
            return "⚠️ 無匹配詞彙，建議新增自訂短語或點選旅遊句子";
        }
        return translatedParts.join(" ");
    }
}

function performTranslation() {
    if (isLoading) {
        outputDiv.innerHTML = "⏳ 詞庫載入中，請稍後...";
        return;
    }
    const rawText = inputTextarea.value;
    if (!rawText.trim()) {
        outputDiv.innerHTML = "⚡ 輸入內容後自動翻譯...";
        return;
    }
    const result = translateWithLongestMatch(rawText, activeForwardMap, activeBackwardMap);
    outputDiv.innerHTML = result;
}

function speakText(text) {
    if (!text || text.startsWith("⚠️") || text.startsWith("⚡")) return;
    const utterance = new SpeechSynthesisUtterance(text);
    const jaRegex = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/;
    const koRegex = /[\uAC00-\uD7AF\u1100-\u11FF]/;
    const engRegex = /[a-zA-Z]/;
    if (koRegex.test(text)) utterance.lang = 'ko-KR';
    else if (jaRegex.test(text)) utterance.lang = 'ja-JP';
    else if (engRegex.test(text) && !/[\u4e00-\u9fff]/.test(text)) utterance.lang = 'en-US';
    else utterance.lang = 'zh-TW';
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
}

function updateTravelPhrasesUI() {
    let phraseList = [];
    if (currentMode === 'japanese') phraseList = travelJaList;
    else if (currentMode === 'korean') phraseList = travelKoList;
    else {
        const generalPhrases = [
            { zh: "你好", target: "Hello" },
            { zh: "謝謝", target: "Thank you" },
            { zh: "多少錢", target: "How much" },
            { zh: "車站在哪裡", target: "Where is the station" }
        ];
        phraseList = generalPhrases;
    }
    
    if (!phraseList.length) {
        travelPhrasesDiv.innerHTML = '<span style="color:gray;">暫無旅遊句子，請檢查JSON檔案</span>';
        return;
    }
    
    travelPhrasesDiv.innerHTML = '';
    phraseList.forEach(phrase => {
        const chip = document.createElement('div');
        chip.className = 'travel-chip';
        chip.textContent = `${phrase.zh}  →  ${phrase.target}`;
        chip.addEventListener('click', () => {
            inputTextarea.value = phrase.zh;
            performTranslation();
        });
        travelPhrasesDiv.appendChild(chip);
    });
}

function setMode(mode) {
    currentMode = mode;
    modeBtns.forEach(btn => {
        if (btn.getAttribute('data-mode') === mode) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
    rebuildActiveMaps();
    updateTravelPhrasesUI();
    performTranslation();
}

function addCustomWord() {
    const source = document.getElementById('newWord').value.trim();
    const target = document.getElementById('newTrans').value.trim();
    if (!source || !target) {
        alert("請填寫原文和翻譯");
        return;
    }
    const modeCust = customDict[currentMode];
    if (!modeCust.forward) modeCust.forward = {};
    if (!modeCust.backward) modeCust.backward = {};
    
    modeCust.forward[source] = target;
    modeCust.backward[target] = source;
    
    saveCurrentCustom();
    rebuildActiveMaps();
    document.getElementById('newWord').value = '';
    document.getElementById('newTrans').value = '';
    alert(`已新增詞彙：${source} → ${target}`);
    performTranslation();
}

function resetCurrentCustom() {
    if (confirm(`確定清除「${currentMode}」模式的所有自訂詞彙嗎？`)) {
        customDict[currentMode] = { forward: {}, backward: {} };
        saveCurrentCustom();
        rebuildActiveMaps();
        performTranslation();
        alert("自訂詞彙已清除");
    }
}

// ----------------------------- 語音輸入功能 -----------------------------
function initSpeechRecognition() {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
        voiceStatusSpan.innerText = '⚠️ 瀏覽器不支援語音輸入';
        if (voiceInputBtn) voiceInputBtn.disabled = true;
        if (voiceStopBtn) voiceStopBtn.disabled = true;
        return;
    }
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'zh-TW';  // 繁體中文辨識
    
    recognition.onstart = () => {
        isRecognizing = true;
        voiceStatusSpan.innerText = '🎙️ 聆聽中... 請說話';
        if (voiceInputBtn) voiceInputBtn.style.opacity = '0.6';
        if (voiceStopBtn) voiceStopBtn.disabled = false;
    };
    
    recognition.onend = () => {
        isRecognizing = false;
        voiceStatusSpan.innerText = '';
        if (voiceInputBtn) voiceInputBtn.style.opacity = '1';
        if (voiceStopBtn) voiceStopBtn.disabled = true;
    };
    
    recognition.onerror = (event) => {
        console.error('語音錯誤:', event.error);
        let errMsg = '';
        if (event.error === 'not-allowed') errMsg = '❌ 未允許麥克風權限';
        else if (event.error === 'no-speech') errMsg = '⏳ 沒有偵測到語音';
        else errMsg = `❌ 錯誤: ${event.error}`;
        voiceStatusSpan.innerText = errMsg;
        setTimeout(() => {
            if (voiceStatusSpan.innerText === errMsg) voiceStatusSpan.innerText = '';
        }, 2500);
        isRecognizing = false;
        if (voiceInputBtn) voiceInputBtn.style.opacity = '1';
        if (voiceStopBtn) voiceStopBtn.disabled = true;
    };
    
    recognition.onresult = (event) => {
        const last = event.results.length - 1;
        let transcript = event.results[last][0].transcript;
        if (transcript) {
            transcript = cleanText(transcript);
            inputTextarea.value = transcript;
            performTranslation();
            voiceStatusSpan.innerText = '✅ 辨識完成';
            setTimeout(() => {
                if (voiceStatusSpan.innerText === '✅ 辨識完成') voiceStatusSpan.innerText = '';
            }, 1500);
        }
        recognition.stop();
    };
}

function startVoiceInput() {
    if (!recognition) {
        alert('語音辨識未初始化或瀏覽器不支援');
        return;
    }
    if (isRecognizing) {
        recognition.stop();
        setTimeout(() => {
            try { recognition.start(); } catch(e) { console.warn(e); }
        }, 200);
    } else {
        try {
            recognition.start();
        } catch(e) {
            console.warn(e);
            voiceStatusSpan.innerText = '請稍後再試';
        }
    }
}

function stopVoiceInput() {
    if (recognition && isRecognizing) {
        recognition.stop();
        voiceStatusSpan.innerText = '⏹️ 已停止聆聽';
        setTimeout(() => {
            if (voiceStatusSpan.innerText === '⏹️ 已停止聆聽') voiceStatusSpan.innerText = '';
        }, 1500);
    }
}

// ----------------------------- 事件綁定 & 初始化 -----------------------------
document.addEventListener('DOMContentLoaded', async () => {
    await loadAllDictionaries();
    
    inputTextarea.addEventListener('input', performTranslation);
    clearBtn.addEventListener('click', () => {
        inputTextarea.value = '';
        outputDiv.innerHTML = "⚡ 輸入內容後自動翻譯...";
    });
    addWordBtn.addEventListener('click', addCustomWord);
    resetCustomBtn.addEventListener('click', resetCurrentCustom);
    speakResultBtn.addEventListener('click', () => {
        const resultText = outputDiv.innerText;
        if (resultText && !resultText.includes("⚠️") && !resultText.includes("⚡")) {
            speakText(resultText);
        } else {
            alert("沒有可朗讀的有效翻譯結果");
        }
    });
    
    // 手動翻譯按鈕
    if (translateBtn) {
        translateBtn.addEventListener('click', performTranslation);
    }
    
    modeBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const mode = btn.getAttribute('data-mode');
            if (mode) setMode(mode);
        });
    });
    
    initSpeechRecognition();
    if (voiceInputBtn) voiceInputBtn.addEventListener('click', startVoiceInput);
    if (voiceStopBtn) voiceStopBtn.addEventListener('click', stopVoiceInput);
    
    performTranslation();
});