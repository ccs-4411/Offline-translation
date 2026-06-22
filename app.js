// app.js
// =========================================================
// 離線翻譯 / 旅遊對話助手
// 功能：
// 1. 中英 / 中日 / 中韓模式切換
// 2. 分類下拉選單
// 3. 搜尋 / 語音搜尋句庫
// 4. 點句子自動播放外語
// 5. 自訂詞彙新增 / 清空
// =========================================================

// ----------------------------- 字典與全域變數 -----------------------------
let currentMode = 'general';
let dictGeneral = { dual: {} };
let dictJapanese = { dual: {} };
let dictKorean = { dual: {} };

let customDict = {
    general: { forward: {}, backward: {} },
    japanese: { forward: {}, backward: {} },
    korean: { forward: {}, backward: {} }
};

let activeForwardMap = {};   // 中文 -> 外文
let activeBackwardMap = {};  // 外文 -> 中文
let categorizedPhraseMap = { general: {}, japanese: {}, korean: {} };

let recognition = null;
let isRecognizing = false;
let recognitionTarget = 'zh';

let currentZhText = "";
let currentForeignText = "";

const CATEGORY_ALL = '全部分類';

// DOM
const phraseSearchInput = document.getElementById('phraseSearch');
const phraseListContainer = document.getElementById('phraseList');
const categorySelect = document.getElementById('categorySelect');
const outputDiv = document.getElementById('outputText');
const clearBtn = document.getElementById('clearBtn');
const addWordBtn = document.getElementById('addWordBtn');
const resetCustomBtn = document.getElementById('resetCustomBtn');

const voiceZhBtn = document.getElementById('voiceZhBtn');
const voiceForeignBtn = document.getElementById('voiceForeignBtn');
const voiceStopBtn = document.getElementById('voiceStopBtn');
const voiceStatusSpan = document.getElementById('voiceStatus');

const speakZhBtn = document.getElementById('speakZhBtn');
const speakForeignBtn = document.getElementById('speakForeignBtn');
const modeBtns = document.querySelectorAll('.mode-btn');
const langHintSpan = document.getElementById('langHint');

// ----------------------------- 工具 -----------------------------
function cleanText(text) {
    return text
        .trim()
        .replace(/[。，！？；：""''（）【】《》…—・、,\.!\?;:\(\)\[\]\{\}<>]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function getFallbackDict(langType) {
    if (langType === 'en') {
        return {
            "你好": "Hello",
            "謝謝": "Thank you",
            "多少錢": "How much",
            "對不起": "Sorry",
            "沒問題": "No problem",
            "請問廁所在哪裡": "Where is the restroom?",
            "我要入住": "I want to check in.",
            "我要退房": "I want to check out.",
            "請給我菜單": "Please give me the menu.",
            "請幫我叫計程車": "Please call a taxi for me."
        };
    }

    if (langType === 'ja') {
        return {
            "你好": "こんにちは",
            "謝謝": "ありがとう",
            "多少錢": "いくらですか",
            "對不起": "すみません",
            "沒問題": "問題ないです",
            "請問廁所在哪裡": "トイレはどこですか",
            "我要入住": "チェックインしたいです",
            "我要退房": "チェックアウトしたいです",
            "請給我菜單": "メニューをください",
            "請幫我叫計程車": "タクシーを呼んでください"
        };
    }

    return {
        "你好": "안녕하세요",
        "謝謝": "감사합니다",
        "多少錢": "얼마예요",
        "對不起": "죄송합니다",
        "沒問題": "문제 없어요",
        "請問廁所在哪裡": "화장실이 어디예요",
        "我要入住": "체크인하고 싶어요",
        "我要退房": "체크아웃하고 싶어요",
        "請給我菜單": "메뉴 좀 주세요",
        "請幫我叫計程車": "택시 좀 불러 주세요"
    };
}

async function loadJSON(url, fallbackObj) {
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`load fail: ${url}`);
        return await res.json();
    } catch (err) {
        console.warn(`載入 ${url} 失敗，改用 fallback`, err);
        return fallbackObj;
    }
}

function saveCurrentCustom() {
    localStorage.setItem(`customDict_${currentMode}`, JSON.stringify(customDict[currentMode]));
}

function loadCustomFromStorage() {
    ['general', 'japanese', 'korean'].forEach(mode => {
        const stored = localStorage.getItem(`customDict_${mode}`);
        if (stored) {
            try {
                customDict[mode] = JSON.parse(stored);
            } catch (e) {
                customDict[mode] = { forward: {}, backward: {} };
            }
        } else {
            customDict[mode] = { forward: {}, backward: {} };
        }
    });
}

// ----------------------------- 分類邏輯 -----------------------------
function getModeSourceMap(mode) {
    if (mode === 'general') return dictGeneral.dual || {};
    if (mode === 'japanese') return dictJapanese.dual || {};
    return dictKorean.dual || {};
}

function categorizePhrase(zh, foreign) {
    const text = `${zh} ${foreign}`.toLowerCase();

    // 交通
    if (
        /車站|捷運|地鐵|公車|巴士|高鐵|火車|月台|計程車|出租車|搭車|機場|航班|班機|登機|行李|護照|海關|轉機|出境|入境/.test(zh) ||
        /station|train|bus|taxi|airport|flight|boarding|luggage|passport|gate/.test(text)
    ) return '交通';

    // 飯店住宿
    if (
        /飯店|酒店|旅館|民宿|入住|退房|房間|雙人房|單人房|房卡|櫃台|毛巾|吹風機|熱水|空調|冷氣|加床|早餐/.test(zh) ||
        /hotel|check in|check out|room|towel|hair dryer|breakfast|front desk/.test(text)
    ) return '飯店住宿';

    // 餐廳點餐
    if (
        /菜單|點餐|外帶|內用|咖啡|茶|飲料|白開水|啤酒|牛奶|好吃|辣|不辣|少冰|少糖|結帳|買單|餐廳|筷子|湯匙|叉子/.test(zh) ||
        /menu|takeout|dine in|coffee|tea|drink|water|spicy|restaurant|bill|check/.test(text)
    ) return '餐廳點餐';

    // 購物
    if (
        /多少錢|價錢|價格|便宜|刷卡|現金|發票|收據|折扣|退稅|尺寸|顏色|試穿|這個|那個|我要買/.test(zh) ||
        /price|cash|card|receipt|discount|tax free|size|color|buy/.test(text)
    ) return '購物';

    // 醫療緊急
    if (
        /醫院|診所|藥局|藥房|發燒|頭痛|肚子痛|過敏|受傷|流血|救護車|警察|不舒服|暈|急診/.test(zh) ||
        /hospital|clinic|pharmacy|fever|headache|allergy|ambulance|police|emergency/.test(text)
    ) return '醫療緊急';

    // 常用對話
    if (
        /你好|謝謝|對不起|不好意思|請問|再見|可以嗎|沒關係|沒問題|幫我|我想|我要|哪裡|怎麼走/.test(zh) ||
        /hello|thank you|sorry|excuse me|please|goodbye|can i|where|how/.test(text)
    ) return '常用對話';

    return '其他';
}

function buildCategoryDataForMode(mode) {
    const sourceMap = getModeSourceMap(mode);
    const result = {
        [CATEGORY_ALL]: []
    };

    // 原始字典
    for (const [zh, foreign] of Object.entries(sourceMap)) {
        const cat = categorizePhrase(zh, foreign);
        if (!result[cat]) result[cat] = [];
        result[cat].push({ zh, foreign });
        result[CATEGORY_ALL].push({ zh, foreign });
    }

    // 自訂字典
    const customForward = customDict[mode]?.forward || {};
    for (const [zh, foreign] of Object.entries(customForward)) {
        const cat = categorizePhrase(zh, foreign);
        if (!result[cat]) result[cat] = [];
        result[cat].push({ zh, foreign });
        result[CATEGORY_ALL].push({ zh, foreign });
    }

    // 去重 + 中文排序
    for (const cat of Object.keys(result)) {
        const seen = new Set();
        result[cat] = result[cat]
            .filter(item => {
                const key = `${item.zh}|||${item.foreign}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            })
            .sort((a, b) => a.zh.localeCompare(b.zh, 'zh-Hant'));
    }

    categorizedPhraseMap[mode] = result;
}

function buildAllCategoryData() {
    buildCategoryDataForMode('general');
    buildCategoryDataForMode('japanese');
    buildCategoryDataForMode('korean');
}

function populateCategorySelect() {
    if (!categorySelect) return;

    const currentCategories = categorizedPhraseMap[currentMode] || {};
    const categoryOrder = [
        CATEGORY_ALL,
        '常用對話',
        '交通',
        '飯店住宿',
        '餐廳點餐',
        '購物',
        '醫療緊急',
        '其他'
    ];

    const oldValue = categorySelect.value || CATEGORY_ALL;
    categorySelect.innerHTML = '';

    categoryOrder.forEach(cat => {
        if (currentCategories[cat]) {
            const option = document.createElement('option');
            option.value = cat;
            option.textContent = cat;
            categorySelect.appendChild(option);
        }
    });

    if (currentCategories[oldValue]) {
        categorySelect.value = oldValue;
    } else {
        categorySelect.value = CATEGORY_ALL;
    }
}

function getCurrentCategoryItems() {
    const modeCategories = categorizedPhraseMap[currentMode] || {};
    const selectedCategory = categorySelect?.value || CATEGORY_ALL;
    return modeCategories[selectedCategory] || [];
}

// ----------------------------- 重建目前詞庫 -----------------------------
function rebuildActiveMaps() {
    let baseForward = {};
    let baseBackward = {};

    if (currentMode === 'general') {
        baseForward = { ...dictGeneral.dual };
        for (let [k, v] of Object.entries(baseForward)) {
            baseBackward[v] = k;
        }
    } else if (currentMode === 'japanese') {
        baseForward = { ...dictJapanese.dual };
        for (let [k, v] of Object.entries(baseForward)) {
            baseBackward[v] = k;
        }
    } else {
        baseForward = { ...dictKorean.dual };
        for (let [k, v] of Object.entries(baseForward)) {
            baseBackward[v] = k;
        }
    }

    const cf = customDict[currentMode].forward || {};
    const cb = customDict[currentMode].backward || {};

    activeForwardMap = { ...baseForward, ...cf };
    activeBackwardMap = { ...baseBackward, ...cb };

    for (let [src, tgt] of Object.entries(cf)) {
        if (!activeBackwardMap[tgt]) activeBackwardMap[tgt] = src;
    }
    for (let [tgt, src] of Object.entries(cb)) {
        if (!activeForwardMap[src]) activeForwardMap[src] = tgt;
    }

    const langLabel =
        currentMode === 'general'
            ? '英文'
            : currentMode === 'japanese'
                ? '日文'
                : '韓文';

    if (voiceForeignBtn) voiceForeignBtn.textContent = `🎤 說${langLabel}篩選`;
    if (langHintSpan) langHintSpan.innerText = `模式: 中${langLabel}雙向對話`;

    buildAllCategoryData();
    populateCategorySelect();

    if (phraseSearchInput) phraseSearchInput.value = '';
    if (phraseListContainer) phraseListContainer.style.display = 'none';
}

// ----------------------------- 顯示翻譯 / 自動播放 -----------------------------
function getForeignLangCode() {
    if (currentMode === 'japanese') return 'ja-JP';
    if (currentMode === 'korean') return 'ko-KR';
    return 'en-US';
}

function renderTranslationView(bigText, smallText, speakLang) {
    if (!outputDiv) return;

    outputDiv.innerHTML = `
        <div style="font-size:1.18rem; font-weight:800; color:#1e3a5f; margin-bottom:6px;">
            ${escapeHtml(bigText)}
        </div>
        <div style="font-size:0.9rem; color:#64748b; font-weight:600;">
            ${escapeHtml(smallText)}
        </div>
    `;

    if (speakLang && bigText && !bigText.includes('未收錄')) {
        const utterance = new SpeechSynthesisUtterance(bigText);
        utterance.lang = speakLang;
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance);
    }
}

// ----------------------------- 篩選與顯示句子 -----------------------------
function filterAndRenderList(keyword = '') {
    if (!phraseListContainer) return;

    phraseListContainer.innerHTML = '';

    const cleanKey = keyword.toLowerCase().trim();
    const currentItems = getCurrentCategoryItems();

    let filteredItems = currentItems;

    if (cleanKey) {
        filteredItems = currentItems.filter(item => {
            const zh = item.zh.toLowerCase();
            const foreign = item.foreign.toLowerCase();
            return zh.includes(cleanKey) || foreign.includes(cleanKey);
        });
    }

    if (!filteredItems.length) {
        phraseListContainer.style.display = 'block';
        phraseListContainer.innerHTML = `
            <div class="phrase-item" style="color:#94a3b8; cursor:default;">
                ❌ 此分類 / 關鍵字下沒有符合句子...
            </div>
        `;
        return;
    }

    filteredItems.forEach(item => {
        const row = document.createElement('div');
        row.className = 'phrase-item';
        row.innerHTML = `
            <span>${escapeHtml(item.zh)}</span>
            <span style="color:#64748b; font-size:0.72rem;">${escapeHtml(item.foreign)}</span>
        `;

        row.addEventListener('click', () => {
            if (phraseSearchInput) phraseSearchInput.value = item.zh;

            currentZhText = item.zh;
            currentForeignText = item.foreign;

            phraseListContainer.style.display = 'none';

            renderTranslationView(
                currentForeignText,
                `中文對照: ${currentZhText}`,
                getForeignLangCode()
            );
        });

        phraseListContainer.appendChild(row);
    });

    phraseListContainer.style.display = 'block';
}

// ----------------------------- 模式切換 -----------------------------
function setMode(mode) {
    if (currentMode === mode) return;

    currentMode = mode;

    modeBtns.forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-mode') === mode);
    });

    rebuildActiveMaps();
    renderTranslationView("✨ 模式已切換，請選分類或輸入關鍵字篩選...", "", null);
    filterAndRenderList('');
}

// ----------------------------- 載入字典 -----------------------------
async function loadAllDictionaries() {
    dictGeneral.dual = await loadJSON('data/zh_en_dual.json', getFallbackDict('en'));
    dictJapanese.dual = await loadJSON('data/zh_ja_dual.json', getFallbackDict('ja'));
    dictKorean.dual = await loadJSON('data/zh_ko_dual.json', getFallbackDict('ko'));

    loadCustomFromStorage();
    rebuildActiveMaps();

    renderTranslationView("✨ 請先選分類，或輸入文字 / 使用語音篩選詞庫...", "", null);

    // 預設直接顯示全部分類
    filterAndRenderList('');
}

// ----------------------------- 語音辨識 -----------------------------
function initSpeechRecognition() {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
        if (voiceStatusSpan) {
            voiceStatusSpan.innerText = '⚠️ 瀏覽器不支援語音功能';
        }
        return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onstart = () => {
        isRecognizing = true;
        if (voiceStatusSpan) {
            voiceStatusSpan.innerText =
                recognitionTarget === 'zh'
                    ? '🎙️ 請說中文關鍵字...'
                    : '🎙️ 請說外文關鍵字...';
        }
    };

    recognition.onend = () => {
        isRecognizing = false;
        if (voiceStatusSpan) {
            voiceStatusSpan.innerText = '';
        }
    };

    recognition.onerror = () => {
        isRecognizing = false;
        if (voiceStatusSpan) {
            voiceStatusSpan.innerText = '❌ 沒聽清楚，請再試一次';
        }
    };

    recognition.onresult = (event) => {
        const transcript = event.results?.[0]?.[0]?.transcript || '';
        if (!transcript) return;

        const cleaned = cleanText(transcript);

        if (phraseSearchInput) {
            phraseSearchInput.value = cleaned;
        }

        filterAndRenderList(cleaned);

        if (outputDiv) {
            outputDiv.innerHTML = `
                <div style="font-size:0.95rem; color:#b45309; font-weight:700;">
                    🎙️ 語音辨識到：「${escapeHtml(cleaned)}」<br>
                    請從上方清單挑選您要的句子。
                </div>
            `;
        }
    };
}

function startVoiceInput(target) {
    if (!recognition) return;

    if (isRecognizing) {
        recognition.stop();
    }

    recognitionTarget = target;
    recognition.lang = target === 'zh' ? 'zh-TW' : getForeignLangCode();

    try {
        recognition.start();
    } catch (e) {
        console.warn(e);
    }
}

function stopVoiceInput() {
    if (recognition && isRecognizing) {
        recognition.stop();
    }
}

// ----------------------------- 自訂詞庫 -----------------------------
function addCustomWord() {
    const newWordInput = document.getElementById('newWord');
    const newTransInput = document.getElementById('newTrans');

    const src = newWordInput?.value.trim() || '';
    const tgt = newTransInput?.value.trim() || '';

    if (!src || !tgt) {
        alert('請完整填寫中文與外文');
        return;
    }

    customDict[currentMode].forward[src] = tgt;
    customDict[currentMode].backward[tgt] = src;
    saveCurrentCustom();
    rebuildActiveMaps();

    currentZhText = src;
    currentForeignText = tgt;

    if (phraseSearchInput) phraseSearchInput.value = src;
    if (categorySelect) categorySelect.value = CATEGORY_ALL;

    filterAndRenderList(src);
    renderTranslationView(tgt, `中文對照: ${src}`, getForeignLangCode());

    if (newWordInput) newWordInput.value = '';
    if (newTransInput) newTransInput.value = '';

    alert('✅ 已成功加進對話庫！');
}

function resetCustomWords() {
    if (!confirm('確定清除當前模式的所有自訂對話？')) return;

    customDict[currentMode] = { forward: {}, backward: {} };
    saveCurrentCustom();
    rebuildActiveMaps();

    if (categorySelect) categorySelect.value = CATEGORY_ALL;
    filterAndRenderList('');
    renderTranslationView("✨ 已清空自訂對話", "", null);
}

// ----------------------------- 播放按鈕 -----------------------------
function speakZh() {
    if (!currentZhText || currentZhText.includes('[未收錄]')) return;
    const utterance = new SpeechSynthesisUtterance(currentZhText);
    utterance.lang = 'zh-TW';
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
}

function speakForeign() {
    if (!currentForeignText || currentForeignText.includes('[未收錄]')) return;
    const utterance = new SpeechSynthesisUtterance(currentForeignText);
    utterance.lang = getForeignLangCode();
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
}

function clearAll() {
    if (phraseSearchInput) phraseSearchInput.value = '';
    currentZhText = '';
    currentForeignText = '';

    if (categorySelect) categorySelect.value = CATEGORY_ALL;

    filterAndRenderList('');
    renderTranslationView("✨ 已重設，請重新選分類或輸入關鍵字...", "", null);
}

// ----------------------------- 事件綁定 -----------------------------
function bindEvents() {
    if (categorySelect) {
        categorySelect.addEventListener('change', () => {
            if (phraseSearchInput) phraseSearchInput.value = '';
            filterAndRenderList('');
        });
    }

    if (phraseSearchInput) {
        phraseSearchInput.addEventListener('input', (e) => {
            filterAndRenderList(e.target.value);
        });

        phraseSearchInput.addEventListener('focus', () => {
            filterAndRenderList(phraseSearchInput.value);
        });
    }

    document.addEventListener('click', (e) => {
        const insideSearchArea =
            e.target.closest('.search-input-wrapper') ||
            e.target.closest('#phraseList') ||
            e.target.closest('#categorySelect');

        if (!insideSearchArea && phraseListContainer) {
            phraseListContainer.style.display = 'none';
        }
    });

    if (clearBtn) clearBtn.addEventListener('click', clearAll);
    if (addWordBtn) addWordBtn.addEventListener('click', addCustomWord);
    if (resetCustomBtn) resetCustomBtn.addEventListener('click', resetCustomWords);

    if (voiceZhBtn) voiceZhBtn.addEventListener('click', () => startVoiceInput('zh'));
    if (voiceForeignBtn) voiceForeignBtn.addEventListener('click', () => startVoiceInput('foreign'));
    if (voiceStopBtn) voiceStopBtn.addEventListener('click', stopVoiceInput);

    if (speakZhBtn) speakZhBtn.addEventListener('click', speakZh);
    if (speakForeignBtn) speakForeignBtn.addEventListener('click', speakForeign);

    modeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            setMode(btn.getAttribute('data-mode'));
        });
    });
}

// ----------------------------- 初始化 -----------------------------
document.addEventListener('DOMContentLoaded', async () => {
    bindEvents();
    await loadAllDictionaries();
    initSpeechRecognition();
});
