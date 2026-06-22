// app.js
// =========================================================
// 離線翻譯 / 旅遊對話助手
// 最終版：加入「外國人回話關鍵詞搜尋模式」
// 功能：
// 1. 中英 / 中日 / 中韓模式切換
// 2. 分類下拉選單
// 3. 搜尋 / 語音搜尋句庫
// 4. 點句子自動播放外語
// 5. 自訂詞彙新增 / 清空
// 6. 外國人回話：語音 -> 關鍵詞抽取 -> 全句庫搜尋排序
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
    return String(text || '')
        .trim()
        .replace(/[。，！？；："'`“”‘’（）【】《》…—・、,\.!\?;:\(\)\[\]\{\}<>]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function escapeHtml(str) {
    return String(str ?? '')
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
            "請幫我叫計程車": "Please call a taxi for me.",
            "請出示護照": "Please show me your passport.",
            "我有訂房": "I have a reservation.",
            "內用還是外帶": "For here or to go?",
            "我要內用": "For here, please.",
            "我要外帶": "To go, please.",
            "請幫我結帳": "Please give me the bill.",
            "請問這個多少錢": "How much is this?",
            "我想去機場": "I want to go to the airport.",
            "我迷路了": "I am lost.",
            "請幫我叫救護車": "Please call an ambulance."
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
            "請幫我叫計程車": "タクシーを呼んでください",
            "請出示護照": "パスポートを見せてください",
            "我有訂房": "予約があります",
            "請幫我結帳": "お会計をお願いします",
            "請問這個多少錢": "これはいくらですか",
            "我想去機場": "空港に行きたいです",
            "我迷路了": "道に迷いました",
            "請幫我叫救護車": "救急車を呼んでください"
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
        "請幫我叫計程車": "택시 좀 불러 주세요",
        "請出示護照": "여권을 보여 주세요",
        "我有訂房": "예약이 있어요",
        "請幫我結帳": "계산해 주세요",
        "請問這個多少錢": "이거 얼마예요",
        "我想去機場": "공항에 가고 싶어요",
        "我迷路了": "길을 잃었어요",
        "請幫我叫救護車": "구급차를 불러 주세요"
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
    const zhText = zh || '';
    const text = `${zh || ''} ${foreign || ''}`.toLowerCase();

    if (
        /車站|捷運|地鐵|公車|巴士|高鐵|火車|月台|計程車|出租車|搭車|機場|航班|班機|登機|行李|護照|海關|轉機|出境|入境/.test(zhText) ||
        /station|train|bus|taxi|airport|flight|boarding|luggage|passport|gate/.test(text) ||
        /駅|空港|電車|バス|タクシー|パスポート/.test(text) ||
        /역|공항|기차|버스|택시|여권/.test(text)
    ) return '交通';

    if (
        /飯店|酒店|旅館|民宿|入住|退房|房間|雙人房|單人房|房卡|櫃台|毛巾|吹風機|熱水|空調|冷氣|加床|早餐|訂房/.test(zhText) ||
        /hotel|check in|check out|room|towel|hair dryer|breakfast|front desk|reservation|booking/.test(text) ||
        /ホテル|チェックイン|チェックアウト|部屋|予約/.test(text) ||
        /호텔|체크인|체크아웃|방|예약/.test(text)
    ) return '飯店住宿';

    if (
        /菜單|點餐|外帶|內用|咖啡|茶|飲料|白開水|啤酒|牛奶|好吃|辣|不辣|少冰|少糖|結帳|買單|餐廳|筷子|湯匙|叉子/.test(zhText) ||
        /menu|takeout|dine in|coffee|tea|drink|water|spicy|restaurant|bill|check|order/.test(text) ||
        /メニュー|会計|レストラン|注文/.test(text) ||
        /메뉴|계산|식당|주문/.test(text)
    ) return '餐廳點餐';

    if (
        /多少錢|價錢|價格|便宜|刷卡|現金|發票|收據|折扣|退稅|尺寸|顏色|試穿|這個|那個|我要買/.test(zhText) ||
        /price|cash|card|receipt|discount|tax free|size|color|buy/.test(text) ||
        /いくら|現金|カード|サイズ/.test(text) ||
        /얼마|현금|카드|사이즈/.test(text)
    ) return '購物';

    if (
        /醫院|診所|藥局|藥房|發燒|頭痛|肚子痛|過敏|受傷|流血|救護車|警察|不舒服|暈|急診/.test(zhText) ||
        /hospital|clinic|pharmacy|fever|headache|allergy|ambulance|police|emergency|doctor/.test(text) ||
        /病院|薬局|救急車/.test(text) ||
        /병원|약국|구급차/.test(text)
    ) return '醫療緊急';

    if (
        /你好|謝謝|對不起|不好意思|請問|再見|可以嗎|沒關係|沒問題|幫我|我想|我要|哪裡|怎麼走/.test(zhText) ||
        /hello|thank you|sorry|excuse me|please|goodbye|can i|where|how/.test(text)
    ) return '常用對話';

    return '其他';
}

function buildCategoryDataForMode(mode) {
    const sourceMap = getModeSourceMap(mode);
    const result = {
        [CATEGORY_ALL]: []
    };

    for (const [zh, foreign] of Object.entries(sourceMap)) {
        const cat = categorizePhrase(zh, foreign);
        if (!result[cat]) result[cat] = [];
        result[cat].push({ zh, foreign });
        result[CATEGORY_ALL].push({ zh, foreign });
    }

    const customForward = customDict[mode]?.forward || {};
    for (const [zh, foreign] of Object.entries(customForward)) {
        const cat = categorizePhrase(zh, foreign);
        if (!result[cat]) result[cat] = [];
        result[cat].push({ zh, foreign });
        result[CATEGORY_ALL].push({ zh, foreign });
    }

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

function getAllItemsForCurrentMode() {
    const modeCategories = categorizedPhraseMap[currentMode] || {};
    return modeCategories[CATEGORY_ALL] || [];
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

    if (voiceForeignBtn) voiceForeignBtn.textContent = `🎤 聽${langLabel}回話`;
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
        <div style="font-size:0.9rem; color:#64748b; font-weight:600; line-height:1.6;">
            ${smallText}
        </div>
    `;

    if (speakLang && bigText && !bigText.includes('未收錄')) {
        const utterance = new SpeechSynthesisUtterance(bigText);
        utterance.lang = speakLang;
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance);
    }
}

// ----------------------------- 一般句庫篩選 -----------------------------
function filterAndRenderList(keyword = '') {
    if (!phraseListContainer) return;

    phraseListContainer.innerHTML = '';

    const cleanKey = keyword.toLowerCase().trim();
    const currentItems = getCurrentCategoryItems();

    let filteredItems = currentItems;

    if (cleanKey) {
        filteredItems = currentItems.filter(item => {
            const zh = (item.zh || '').toLowerCase();
            const foreign = (item.foreign || '').toLowerCase();
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
                `中文對照: ${escapeHtml(currentZhText)}`,
                getForeignLangCode()
            );
        });

        phraseListContainer.appendChild(row);
    });

    phraseListContainer.style.display = 'block';
}

// =========================================================
// 外國人回話關鍵詞搜尋模式
// =========================================================

// 英文停用字
const EN_STOPWORDS = new Set([
    "please", "can", "could", "would", "will", "shall", "may", "might",
    "i", "me", "my", "mine", "you", "your", "yours", "we", "our", "ours",
    "he", "she", "they", "them", "their", "theirs", "it", "its",
    "the", "a", "an", "this", "that", "these", "those",
    "is", "are", "am", "was", "were", "be", "been", "being",
    "do", "does", "did", "have", "has", "had",
    "to", "for", "of", "in", "on", "at", "with", "from", "by", "as",
    "and", "or", "but", "if", "then", "so", "than", "very", "just",
    "there", "here", "okay", "ok", "yes", "no", "sir", "madam", "hi", "hello",
    "um", "uh", "well"
]);

// 日文簡化停用字
const JA_STOPWORDS = new Set([
    "です", "ます", "でした", "ません", "ください", "お願い", "します",
    "は", "が", "を", "に", "で", "と", "も", "の", "か", "ね", "よ"
]);

// 韓文簡化停用字
const KO_STOPWORDS = new Set([
    "주세요", "합니다", "해요", "입니다", "있어요", "없어요",
    "은", "는", "이", "가", "을", "를", "에", "에서", "도", "요"
]);

function normalizeForeignSentence(text) {
    return cleanText(
        String(text || '')
            .toLowerCase()
            .replace(/check-in/g, 'check in')
            .replace(/check-out/g, 'check out')
            .replace(/take-out/g, 'take out')
            .replace(/to-go/g, 'to go')
            .replace(/credit card/g, 'card')
            .replace(/room key/g, 'key')
    );
}

function tokenizeForeignText(text, mode = currentMode) {
    const normalized = normalizeForeignSentence(text);
    if (!normalized) return [];

    let tokens = normalized.split(/\s+/).filter(Boolean);

    if (mode === 'general') {
        tokens = tokens.filter(t => !EN_STOPWORDS.has(t) && t.length > 1);
    } else if (mode === 'japanese') {
        tokens = tokens.filter(t => !JA_STOPWORDS.has(t) && t.length > 0);
    } else if (mode === 'korean') {
        tokens = tokens.filter(t => !KO_STOPWORDS.has(t) && t.length > 0);
    }

    return [...new Set(tokens)];
}

function getBoostKeywords(mode = currentMode) {
    if (mode === 'general') {
        return {
            "passport": 6,
            "reservation": 6,
            "booking": 6,
            "check": 4,
            "checkin": 4,
            "check-in": 4,
            "checkout": 4,
            "check-out": 4,
            "room": 5,
            "key": 4,
            "bill": 5,
            "menu": 5,
            "order": 4,
            "cash": 5,
            "card": 5,
            "price": 4,
            "ticket": 5,
            "train": 5,
            "bus": 5,
            "taxi": 5,
            "airport": 5,
            "luggage": 5,
            "toilet": 4,
            "restroom": 4,
            "spicy": 4,
            "allergy": 5,
            "hospital": 6,
            "pharmacy": 6,
            "doctor": 6,
            "reservation": 6,
            "late": 2,
            "early": 2
        };
    }

    if (mode === 'japanese') {
        return {
            "パスポート": 6,
            "予約": 6,
            "チェックイン": 5,
            "チェックアウト": 5,
            "部屋": 5,
            "鍵": 4,
            "メニュー": 5,
            "会計": 5,
            "現金": 5,
            "カード": 5,
            "駅": 5,
            "空港": 5,
            "タクシー": 5,
            "病院": 6,
            "薬局": 6
        };
    }

    return {
        "여권": 6,
        "예약": 6,
        "체크인": 5,
        "체크아웃": 5,
        "방": 5,
        "열쇠": 4,
        "메뉴": 5,
        "계산": 5,
        "현금": 5,
        "카드": 5,
        "역": 5,
        "공항": 5,
        "택시": 5,
        "병원": 6,
        "약국": 6
    };
}

function scorePhraseByKeywords(item, keywords, mode = currentMode) {
    const foreignNorm = normalizeForeignSentence(item.foreign || '');
    const zhNorm = cleanText((item.zh || '').toLowerCase());

    let score = 0;
    let matched = [];

    const boosts = getBoostKeywords(mode);

    for (const kw of keywords) {
        let kwScore = 0;
        if (!kw) continue;

        // 外文完整包含
        if (foreignNorm.includes(kw)) {
            kwScore += 3;
        }

        // 中文偶爾也可命中
        if (zhNorm.includes(kw)) {
            kwScore += 1;
        }

        // 特殊權重字
        if (boosts[kw]) {
            kwScore += boosts[kw];
        }

        // 英文簡易字根處理
        if (mode === 'general' && kw.length >= 4) {
            const root = kw.replace(/(ing|ed|es|s)$/i, '');
            if (root && root !== kw && foreignNorm.includes(root)) {
                kwScore += 2;
            }
        }

        if (kwScore > 0) {
            matched.push(kw);
            score += kwScore;
        }
    }

    // 命中多個關鍵詞再加分
    if (matched.length >= 2) score += matched.length * 1.5;
    if (matched.length >= 3) score += 2;

    // 類別輕量加分：如果是高頻旅遊句
    const cat = categorizePhrase(item.zh, item.foreign);
    if (cat !== '其他') score += 0.5;

    return { score, matched };
}

function searchForeignReplyByKeywords(rawSentence) {
    const keywords = tokenizeForeignText(rawSentence, currentMode);
    const allItems = getAllItemsForCurrentMode();

    if (!keywords.length) {
        return { keywords: [], results: [] };
    }

    const scored = allItems.map(item => {
        const { score, matched } = scorePhraseByKeywords(item, keywords, currentMode);
        return { ...item, score, matched };
    });

    const results = scored
        .filter(item => item.score > 0)
        .sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            return a.zh.localeCompare(b.zh, 'zh-Hant');
        })
        .slice(0, 12);

    return { keywords, results };
}

function renderForeignReplySearchResult(rawSentence, keywords, results) {
    if (!phraseListContainer || !outputDiv) return;

    const keywordHtml = keywords.length
        ? keywords.map(k =>
            `<span style="display:inline-block;background:#eef6ff;color:#2563eb;padding:3px 8px;border-radius:999px;margin:2px;font-size:0.82rem;">${escapeHtml(k)}</span>`
        ).join('')
        : '<span style="color:#94a3b8;">(無法抽出有效關鍵詞)</span>';

    outputDiv.innerHTML = `
        <div style="font-size:1rem; font-weight:800; color:#1e3a5f; margin-bottom:8px;">
            🎧 外國人回話辨識結果
        </div>
        <div style="font-size:0.9rem; color:#334155; line-height:1.7; margin-bottom:10px;">
            <div><b>原句：</b>${escapeHtml(rawSentence)}</div>
            <div style="margin-top:6px;"><b>抽出的關鍵詞：</b><br>${keywordHtml}</div>
            <div style="margin-top:8px; color:#64748b;">
                已從 <b>目前語言模式的全部句庫</b> 幫你找最接近的句子，請從下方挑選。
            </div>
        </div>
    `;

    phraseListContainer.innerHTML = '';

    if (!results.length) {
        phraseListContainer.style.display = 'block';
        phraseListContainer.innerHTML = `
            <div class="phrase-item" style="color:#94a3b8; cursor:default; line-height:1.7;">
                ❌ 找不到接近的句子。<br>
                建議：<br>
                1. 再講一次，讓辨識更完整<br>
                2. 先切到更接近的語言模式<br>
                3. 後面可再補更多常用旅遊句到 JSON
            </div>
        `;
        return;
    }

    results.forEach(item => {
        const row = document.createElement('div');
        row.className = 'phrase-item';

        const matchedText = item.matched?.length
            ? `命中：${item.matched.join(', ')}`
            : '';

        row.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:3px; width:100%;">
                <span style="font-weight:700;">${escapeHtml(item.zh)}</span>
                <span style="color:#64748b; font-size:0.76rem;">${escapeHtml(item.foreign)}</span>
                <span style="color:#94a3b8; font-size:0.7rem;">${escapeHtml(matchedText)}</span>
            </div>
        `;

        row.addEventListener('click', () => {
            if (phraseSearchInput) phraseSearchInput.value = item.zh;

            currentZhText = item.zh;
            currentForeignText = item.foreign;

            phraseListContainer.style.display = 'none';

            renderTranslationView(
                currentForeignText,
                `中文對照: ${escapeHtml(currentZhText)}`,
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
    renderTranslationView("✨ 模式已切換，請選分類、輸入關鍵字，或直接聽外國人回話...", "", null);
    filterAndRenderList('');
}

// ----------------------------- 載入字典 -----------------------------
async function loadAllDictionaries() {
    dictGeneral.dual = await loadJSON('data/zh_en_dual.json', getFallbackDict('en'));
    dictJapanese.dual = await loadJSON('data/zh_ja_dual.json', getFallbackDict('ja'));
    dictKorean.dual = await loadJSON('data/zh_ko_dual.json', getFallbackDict('ko'));

    loadCustomFromStorage();
    rebuildActiveMaps();

    renderTranslationView(
        "✨ 請先選分類，或輸入文字 / 使用語音搜尋。也可以直接按『聽外國人回話』讓系統抓關鍵詞找句子。",
        "",
        null
    );

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
            if (recognitionTarget === 'zh') {
                voiceStatusSpan.innerText = '🎙️ 請說中文關鍵字...';
            } else {
                voiceStatusSpan.innerText = '🎙️ 請讓外國人說話...';
            }
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

        if (recognitionTarget === 'zh') {
            // 中文語音：在目前分類內搜尋
            if (phraseSearchInput) {
                phraseSearchInput.value = cleaned;
            }

            filterAndRenderList(cleaned);

            if (outputDiv) {
                outputDiv.innerHTML = `
                    <div style="font-size:0.95rem; color:#b45309; font-weight:700; line-height:1.7;">
                        🎙️ 語音辨識到中文關鍵字：<br>
                        「${escapeHtml(cleaned)}」<br>
                        請從下方清單挑選您要的句子。
                    </div>
                `;
            }
        } else {
            // 外文語音：外國人回話關鍵詞搜尋模式
            const { keywords, results } = searchForeignReplyByKeywords(cleaned);

            if (phraseSearchInput) {
                phraseSearchInput.value = cleaned;
            }

            renderForeignReplySearchResult(cleaned, keywords, results);
        }
    };
}

function startVoiceInput(target) {
    if (!recognition) return;

    if (isRecognizing) {
        recognition.stop();
    }

    recognitionTarget = target;

    if (target === 'zh') {
        recognition.lang = 'zh-TW';
    } else {
        recognition.lang = getForeignLangCode();
    }

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
    renderTranslationView(tgt, `中文對照: ${escapeHtml(src)}`, getForeignLangCode());

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
    renderTranslationView("✨ 已重設，請重新選分類、輸入關鍵字，或直接聽外國人回話...", "", null);
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

