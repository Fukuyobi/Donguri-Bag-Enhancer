// ==UserScript==
// @name         Donguri Bag Enhancer
// @namespace    https://donguri.5ch.io/
// @version      14.3.0.0
// @description  5ちゃんねる「どんぐりシステム」の「アイテムバッグ」ページ機能改良スクリプト。
// @author       Author: 福呼び草 / Assistant: ChatGPT（OpenAI）
// @contributor  Suggested by: 'ID:YTtKPa4Z0'
// @license      MIT license
// @match        https://donguri.5ch.io/
// @match        https://donguri.5ch.io
// @match        https://donguri.5ch.io/bag
// @match        https://donguri.5ch.io/chest
// @match        https://donguri.5ch.io/battlechest
// @match        https://donguri.5ch.io/itemwatch
// @match        https://donguri.5ch.io/craft
// @match        https://donguri.world/
// @match        https://donguri.world
// @match        https://donguri.world/bag
// @match        https://donguri.world/chest
// @match        https://donguri.world/battlechest
// @match        https://donguri.world/itemwatch
// @match        https://donguri.world/craft
// @run-at       document-end
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// ==/UserScript==

// 〓〓〓〓〓〓 共通定義 〓〓〓〓〓〓
(function(){
  'use strict';
  // ============================================================
  // スクリプト自身のバージョン（About 表示用）
  // ============================================================
  const DBE_VERSION    = '14.3.0.0';

  // ============================================================
  // 現在のどんぐりドメイン
  // - 固定ドメイン文字列に依存しないよう、実行中オリジンを使う
  // ============================================================
  const DBE_ORIGIN = location.origin;

  // ============================================================
  // DBE 共有ストレージ
  // - localStorage はオリジン単位のため、donguri.5ch.io と donguri.world で分離される
  // - Tampermonkey の GM_* ストレージを優先し、同一ユーザースクリプト内で保存値を共有する
  // - 既存 localStorage 値は、GM 側に値がまだ無いキーだけ初回読取時に移行する
  // ============================================================
  const dbeStorage = (()=>{
    const hasGM = (typeof GM_getValue === 'function' && typeof GM_setValue === 'function');

    function readLocal(key){
      try{
        return window.localStorage.getItem(key);
      }catch(_){
        return null;
      }
    }
    function writeLocal(key, value){
      try{
        window.localStorage.setItem(key, String(value));
      }catch(_){}
    }
    function removeLocal(key){
      try{
        window.localStorage.removeItem(key);
      }catch(_){}
    }
    function listLocalKeys(){
      const keys = [];
      try{
        for (let i = 0; i < window.localStorage.length; i++){
          const k = window.localStorage.key(i);
          if (k) keys.push(k);
        }
      }catch(_){}
      return keys;
    }
    function listKeys(){
      const keys = new Set();
      if (hasGM && typeof GM_listValues === 'function'){
        try{
          (GM_listValues() || []).forEach(k=>keys.add(String(k)));
        }catch(e){
          console.warn('[DBE] GM_listValues failed; fallback to localStorage key scan:', e);
        }
      }
      listLocalKeys().forEach(k=>keys.add(k));
      return Array.from(keys);
    }

    return {
      getItem(key){
        const k = String(key || '');
        if (!k) return null;
        if (hasGM){
          try{
            const gmValue = GM_getValue(k, null);
            if (gmValue !== null && gmValue !== undefined) return String(gmValue);

            // 既存ユーザー向け：現ドメインの localStorage に残っている値を共有ストレージへ昇格
            const localValue = readLocal(k);
            if (localValue !== null){
              try{ GM_setValue(k, String(localValue)); }catch(_){}
              return String(localValue);
            }
            return null;
          }catch(e){
            console.warn('[DBE] GM_getValue failed; fallback to localStorage:', k, e);
          }
        }
        return readLocal(k);
      },
      setItem(key, value){
        const k = String(key || '');
        if (!k) return;
        const v = String(value);
        if (hasGM){
          try{ GM_setValue(k, v); }catch(e){ console.warn('[DBE] GM_setValue failed:', k, e); }
        }
        // GM 非対応環境へのフォールバック兼、旧版へ戻した場合の保険として現ドメインにも残す
        writeLocal(k, v);
      },
      removeItem(key){
        const k = String(key || '');
        if (!k) return;
        if (hasGM && typeof GM_deleteValue === 'function'){
          try{ GM_deleteValue(k); }catch(e){ console.warn('[DBE] GM_deleteValue failed:', k, e); }
        }
        removeLocal(k);
      },
      key(index){
        const keys = listKeys();
        return keys[index] || null;
      },
      get length(){
        return listKeys().length;
      }
    };
  })();

  // ============================================================
  // 多重起動ガード（同一ページで DBE が複数注入される事故を防ぐ）
  // - 既に同等以上のバージョンが動いている場合、このインスタンスは停止
  // - 旧版が後から注入された場合も、旧版側が停止する
  // ============================================================
  function dbeParseVersion(v){
    return String(v || '')
      .split('.')
      .map(s=>{
        const n = parseInt(s, 10);
        return Number.isFinite(n) ? n : 0;
      });
  }
  function dbeCompareVersion(a, b){
    const A = dbeParseVersion(a);
    const B = dbeParseVersion(b);
    const len = Math.max(A.length, B.length);
    for (let i = 0; i < len; i++){
      const x = A[i] || 0;
      const y = B[i] || 0;
      if (x > y) return 1;
      if (x < y) return -1;
    }
    return 0;
  }
  try{
    const prev = window.__DBE_ACTIVE_VERSION;
    if (prev && dbeCompareVersion(prev, DBE_VERSION) >= 0){
      console.warn('[DBE] another instance already running (version=' + prev + '), skip current version=' + DBE_VERSION);
      return;
    }
    window.__DBE_ACTIVE_VERSION = DBE_VERSION;
  }catch(_){}

  // ============================================================
  // Chest 処理の診断ログ（必要に応じて false に）
  // ============================================================
  const DBE_CHEST_DIAG = true;
  const chestDiag = (...args)=>{ try{ if(DBE_CHEST_DIAG) console.log('[DBE][ChestDiag]', ...args);}catch(_){} };

  // ============================================================
  // DBE rarity parser (weapon/armor) - bracket-only
  // 例: 「ウサギの耳R」の末尾Rは名前の一部なのでレアリティ扱いしない
  // レアリティ表記は [UR][SSR][SR][R][N] のみを対象
  // ============================================================
  function dbePickRarityFromText(raw){
    const s = String(raw || '');
    // 1) ブラケット表記 [UR] [SSR] [SR] [R] [N]
    let m = s.match(/\[\s*(UR|SSR|SR|R|N)\s*\]/);
    if (m) return m[1];
    // 2) セルがレアリティ記号のみの場合（列が分かれているケース）
    m = s.trim().match(/^(UR|SSR|SR|R|N)$/);
    return m ? m[1] : '';
  }

  // ============================================================
  // DBE name-badge API bootstrap (ensure available before any usage) ---
  // ============================================================
  function dbeEnsureNameBadgeApi(){
    if (window.DBE_setNameBadge) return window.DBE_setNameBadge;
    function ensureNameBadgeHost(nameCell){
      if (!nameCell) return null;
      nameCell.style.position = nameCell.style.position || 'relative';
      let host = nameCell.querySelector('.dbe-name-badges');
      if (!host){
        host = document.createElement('span');
        host.className = 'dbe-name-badges';
        host.style.cssText = [
          'position:absolute','right:4px','top:0',
          'display:flex','gap:4px',
          'align-items:flex-start','justify-content:flex-end',
          'pointer-events:none','font-size:1.2em','white-space:nowrap'
        ].join(';');
        nameCell.appendChild(host);
      }
      return host;
    }
    function setBadge(nameCell, type, show){
      const host = ensureNameBadgeHost(nameCell);
      if (!host) return;
      const CLS   = {new:'dbe-badge-new', lock:'dbe-badge-lock'};
      const TXT   = {new:'🔰',            lock:'🔒'};
      const ORDER = {new:'1',             lock:'2'};
      const cls = CLS[type]; if (!cls) return;
      let el = host.querySelector('.'+cls);
      if (show){
        if (!el){
          el = document.createElement('span');
          el.className = cls;
          el.textContent = TXT[type] || '';
          el.style.cssText = 'order:'+ORDER[type]+';';
          host.appendChild(el);
        }
      } else {
        if (el) el.remove();
        if (!host.querySelector(':scope > span')) host.remove();
      }
    }
    window.DBE_setNameBadge = {
      newbie :(td,on)=>setBadge(td,'new',!!on),
      lock   :(td,on)=>setBadge(td,'lock',!!on),
    };
    return window.DBE_setNameBadge;
  }

  // Ensure global chest namespace exists even for early handlers
  if (!('DBE_CHEST' in window)) { window.DBE_CHEST = {}; }
  chestDiag('BOOT: script loaded, DBE_VERSION=', DBE_VERSION, 'pathname=', location.pathname);

  // ============================================================
  // トップページ（https://donguri.5ch.io/）での「どんぐりネーム / どんぐりID」取得・記憶
  // - 左ペイン（.stats.header の最初の <div>）から抽出
  // - どんぐりネーム：<div style="font-size:2em;">...</div> の textContent
  // - どんぐりID：『ID: 』に続く半角英数字
  // - 取得できた場合のみ localStorage を更新（変化があれば上書き）
  // - トップページではこの処理のみ実行して return（他機能は走らせない）
  // ============================================================
  function dbeCaptureDonguriIdentityFromTop(){
    try{
      const root = (document.querySelector('.stats.header') || null);
      if (!root) return false;

      // 左ペイン：最初の <div>
      const panes = root.querySelectorAll(':scope > div');
      const leftPane = panes && panes.length ? panes[0] : null;
      if (!leftPane) return false;

      // どんぐりネーム：font-size:2em を含む div（なければ先頭divをフォールバック）
      let name = '';
      const nameDiv =
        leftPane.querySelector('div[style*="font-size:2em"]') ||
        leftPane.querySelector('div');
      if (nameDiv){
        name = (nameDiv.textContent || '').trim();
      }

      // どんぐりID：ID: に続く半角英数字
      let did = '';
      const idText = (leftPane.textContent || '');
      const m = idText.match(/ID:\s*([0-9A-Za-z]+)/);
      if (m) did = m[1];

      // 取得できたものだけ更新（変化があれば上書き）
      let updated = false;
      if (name){
        const prev = dbeStorage.getItem('donguri-name');
        if (prev !== name){
          dbeStorage.setItem('donguri-name', name);
          updated = true;
        }
      }
      if (did){
        const prev = dbeStorage.getItem('donguri-id');
        if (prev !== did){
          dbeStorage.setItem('donguri-id', did);
          updated = true;
        }
      }

      if (updated){
        try{
          console.log('[DBE] donguri identity updated:', {
            'donguri-name': dbeStorage.getItem('donguri-name') || '',
            'donguri-id'  : dbeStorage.getItem('donguri-id')   || ''
          });
        }catch(_){}
      } else {
        try{
          console.debug('[DBE] donguri identity unchanged:', {
            'donguri-name': dbeStorage.getItem('donguri-name') || '',
            'donguri-id'  : dbeStorage.getItem('donguri-id')   || ''
          });
        }catch(_){}
      }
      return true;
    }catch(err){
      console.warn('[DBE] failed to capture donguri identity from top:', err);
      return false;
    }
  }

  // トップページ判定（/ または空）
  if (location && (location.pathname === '/' || location.pathname === '')){
    dbeCaptureDonguriIdentityFromTop();
    return;
  }

  // ============================================================
  // 設定キー
  // ============================================================
  const anchorKey   = 'donguriItemTableResetAnchor';
  const lockReloadItemAnchorKey = 'donguriLockUnlockReloadItemAnchor';
  const overlayId   = 'donguriLoadingOverlay';
  const tableIds    = ['necklaceTable','weaponTable','armorTable'];

  // 先に定義してからエイリアスで参照（未定義参照を防ぐ）
  const HIDE_KEY       = 'donguriHideRecycleBtn';
  const SHOW_DELTA_KEY = 'donguriShowDeltaColumn';

  // 新しい安定ID ↔ 既存キー のエイリアス）
  const DBE_KEYS = {
    unlockedColor:     { id:'dbe-prm-panel0-setcol.ll-unlocked',        legacy:'unlockedColor',            def:'#ff6600'              },
    lockedColor:       { id:'dbe-prm-panel0-setcolor-cell-locked',      legacy:'lockedColor',              def:'#ffffff'              },
    showSimpleNecAttr: { id:'dbe-prm-panel0-check-simple-nec-attr',     legacy:null,                       def:false                    },
    showDelta:         { id:'dbe-prm-panel0-check-display-necClm-Dlta', legacy: SHOW_DELTA_KEY,            def:false                    },
    hideKindClass:     { id:'dbe-prm-panel0-check-hide-NameSub',        legacy:null,                       def:false                    },
    hideLockCol:       { id:'dbe-prm-panel0-check-hide-Clm-Lock',       legacy:null,                       def:false                    },
    hideRyclCol:       { id:'dbe-prm-panel0-check-hide-Clm-Rycl',       legacy:'donguriHideColumn-global', def:false                    },
    hideAllBtn:        { id:'dbe-prm-panel0-check-hide-RyclUnLck',      legacy: HIDE_KEY,                  def:false                    },
    baseFontSize:      { id:'dbe-prm-panel0-fontsize',                  legacy:null,                       def:getDefaultBaseFontSize() },
    displayItemId:     { id:'dbe-prm-panel0-check-display-ItemID',      legacy:null,                       def:false                    },
    mobileLauncherPos: { id:'dbe-prm-panel0-radio-mobile-launcher-pos', legacy:null,                       def:'left-bottom'            },
    // トップページ取得値（localStorage 直読み用途にも使えるよう定義）
    donguriName:       { id:'donguri-name',                             legacy:null,                       def:''                       },
    donguriId:         { id:'donguri-id',                               legacy:null,                       def:''                       },
  };

  // ============================================================
  // デバイスに応じた基準文字サイズの初期値（PC/タブレット=16px、スマホ=14px）
  // ============================================================
  function getDefaultBaseFontSize(){
    try{
      const ua = navigator.userAgent || '';
      const isMobi = /Mobi|iPhone|Windows Phone|Android.+Mobile/.test(ua);
      const vpMin  = Math.min(window.innerWidth || 0, window.innerHeight || 0);
      const isSmallViewport = vpMin > 0 ? (vpMin <= 768) : false;
      return (isMobi || isSmallViewport) ? '14px' : '16px';
    }catch(_e){
      return '16px';
    }
  }

  // ============================================================
  // セル余白（パディング）設定
  // ============================================================
  const CELL_PAD_V_KEY = 'dbe_cellpad_vertical_px';   // 上下(px)
  const CELL_PAD_H_KEY = 'dbe_cellpad_horizontal_px'; // 左右(px)
  const CELL_PAD_DEFAULT_V = 4; // 初期値: 上下 4px
  const CELL_PAD_DEFAULT_H = 4; // 初期値: 左右 8px

  // ============================================================
  // 新フォーム（《フィルタカード》新規作成フォーム）を有効化するフラグ
  // ============================================================
  const DBE_USE_NEW_FILTER_FORM = true;

  // ============================================================
  // 既定値ありの文字列読取（ID優先 → 旧キー → 既定値）
  // ============================================================
  function readStr(key){
    const { id, legacy, def } = DBE_KEYS[key];
    // 1) まず現行IDキー
    const v = dbeStorage.getItem(id);
    if (v !== null) return v;
    // 2) つぎに旧キー（レガシー互換）
    const wnd = legacy ? dbeStorage.getItem(legacy) : null;
    if (wnd !== null) return wnd;
    // 3) どちらも無ければ既定値
    return def;
  }
  // 真偽値読み取り
  function readBool(key){
    const v = readStr(key);
    return (v === 'true' || v === true);
  }
  function writeStr(key,val){ const {id,legacy}=DBE_KEYS[key]; dbeStorage.setItem(id,val); if (legacy) dbeStorage.setItem(legacy,val); }
  function writeBool(key,val){ writeStr(key, String(!!val)); }

  // ============================================================
  // ラダーモードの制限値に照らし、アイテムIDによる抽出を行う初期値（テキストボックスのデフォルト値）
  // ※ UI の <input type="text"> には id="dbe-filterui-itemidfilter-threshold" を付与します
  // ============================================================
  const DEFAULT_ITEMIDFILTER_THRESHOLD = 169000000;

  // ============================================================
  // マッピング
  // ============================================================
  const titleMap    = { necklaceTable: 'necklaceTitle', weaponTable: 'weaponTitle', armorTable: 'armorTitle' };
  const labelMap    = { necklaceTable: '━━ ネックレス ━━', weaponTable: '━━ 武器 ━━', armorTable: '━━ 防具 ━━' };
  const columnIds   = {
    necklaceTable: { 'ネックレス':'necClm-Name','装':'necClm-Equp','解':'necClm-Lock','属性':'necClm-StEf','マリモ':'necClm-Mrim','分解':'necClm-Rycl','増減':'necClm-Dlta' },
    weaponTable:   { '武器':'wepClm-Name','装':'wepClm-Equp','解':'wepClm-Lock','ATK':'wepClm-Atk','SPD':'wepClm-Spd','CRIT':'wepClm-Crit','ELEM':'wepClm-Elem','MOD':'wepClm-Mod','マリモ':'wepClm-Mrim','分解':'wepClm-Rycl' },
    armorTable:    { '防具':'amrClm-Name','装':'amrClm-Equp','解':'amrClm-Lock','DEF':'amrClm-Def','WT.':'amrClm-Wgt','CRIT':'amrClm-Crit','ELEM':'amrClm-Elem','MOD':'amrClm-Mod','マリモ':'amrClm-Mrim','分解':'amrClm-Rycl' }
  };
  const elemColors  = { '火':'#FFEEEE','氷':'#EEEEFF','雷':'#FFFFEE','風':'#EEFFEE','地':'#FFF0E0','水':'#EEFFFF','光':'#FFFFF0','闇':'#F0E0FF','なし':'#FFFFFF' };
  const elemOrder   = { '火':0,'氷':1,'雷':2,'風':3,'地':4,'水':5,'光':6,'闇':7,'なし':8 };
  const rarityOrder = { 'UR':0,'SSR':1,'SR':2,'R':3,'N':4 };

  const gradeOrder  = { 'Pt':0,'Au':1,'Ag':2,'CuSn':3,'Cu':4 };
  const gradeNames  = { 'Pt':'プラチナ','Au':'金','Ag':'銀','CuSn':'青銅','Cu':'銅' };
  const buffKeywords   = ['強化された','増幅された','力を増した','クリアになった','加速した','高まった','固くなった','尖らせた'];
  const debuffKeywords = ['静まった','弱まった','制限された','ぼやけた','減速した','減少した','砕けた','薄まった','緩んだ','侵食された','鈍らせた'];
  const statusMap      = {
    '攻撃の嵐':'storm','元素の混沌':'chaos','破滅の打撃':'blow','解き放たれた力':'release',
    '精度の道':'accuracy','時間の流れ':'time','生命の本質':'life','石の守り':'stone',
    '守護者の直感':'intuition','影のヴェール':'veil','運命の手':'hand','運命の盾':'shield','運命の賭博':'bet'
  };

  // ============================================================
  // 統一レジストリ方式
  //   ※[表示名 { kana:読み仮名, category:'event'|'limited'|'regular' }]
  //   ※ category は
  //      'event'   = イベント中装備
  //      'limited' = 限定装備
  //      'regular' = 常設装備
  //     を表す
  //   ※互換のため、旧形式 { limited:true|false } も受理
  //   ※さらに eventActive:true を付けた場合は category 指定より優先して
  //     「イベント中装備」として扱う
  //   ※イベント未開催時は 'event' 登録が 0 件でもよい
  //     （空カテゴリとして存在）
  //   ※下のレジストリから派生構造
  //     （weaponKana/armorKana, eventWeapon/eventArmor, limitedWeapon/limitedArmor）
  //     を自動生成します
  // ============================================================

  // ============================================================
  // 武器/防具 世代マーカー
  // - 公式側で旧世代装備のアイテム名末尾に「*」が付与される
  // - 世代は違っても同一アイテムとして扱う場面（名称ソート/レジストリ照合/同名抽出）では
  //   末尾「*」を除去した基準名を使う
  // - フィルターでは「*」あり=LEGACY、「*」なし=SYNERGY として扱う
  // ============================================================
  function dbeStripLegacyGenerationMark(name){
    return String(name || '').normalize('NFKC').trim().replace(/\*+$/u, '').trim();
  }

  function dbeIsLegacyGenerationName(name){
    return /\*+\s*$/u.test(String(name || '').normalize('NFKC'));
  }

  function makeKey(s){
    if (!s) return '';
    return dbeStripLegacyGenerationMark(s).normalize('NFKC').toUpperCase().trim();
  }

  function normalizeRegistryCategory(meta){
    if (!meta || typeof meta !== 'object') return 'regular';
    if (meta.eventActive === true) return 'event';
    if (meta.category === 'event' || meta.category === 'limited' || meta.category === 'regular'){
      return meta.category;
    }
    if (meta.limited === true) return 'limited';
    return 'regular';
  }

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  // レジストリ（武器）
  // ※現在イベント中として扱いたい装備には eventActive:true を付与してください
  // 例:
  // ['装備名', { kana:'ソウビメイ', limited:true, eventActive:true }],
  // ['装備名', { kana:'ソウビメイ', category:'event' }],
  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

  // レジストリ（常設武器）
  const weaponRegistry = new Map([
    ['F5アタック',                 { kana:'F5アタック',                       limited:false }],
    ['怒りの黒電話',               { kana:'イカリノクロデンワ',               limited:false }],
    ['おたま',                     { kana:'オタマ',                           limited:false }],
    ['おにぎらず',                 { kana:'オニギラズ',                       limited:false }],
    ['熊手',                       { kana:'クマデ',                           limited:false }],
    ['高圧洗浄機',                 { kana:'コウアツセンジョウキ',             limited:false }],
    ['小枝',                       { kana:'コエダ',                           limited:false }],
    ['小枝の刀',                   { kana:'コエダノカタナ',                   limited:false }],
    ['ゴムチキン',                 { kana:'ゴムチキン',                       limited:false }],
    ['白胡椒',                     { kana:'シロコショウ',                     limited:false }],
    ['スリングショット',           { kana:'スリングショット',                 limited:false }],
    ['どんぐり大砲',               { kana:'ドングリタイホウ',                 limited:false }],
    ['どんぐりハンマ',             { kana:'ドングリハンマ',                   limited:false }],
    ['ヌンチャク',                 { kana:'ヌンチャク',                       limited:false }],
    ['伸び切ったゴム紐',           { kana:'ノビキッタゴムヒモ',               limited:false }],
    ['ハエ叩き',                   { kana:'ハエタタキ',                       limited:false }],
    ['はたき',                     { kana:'ハタキ',                           limited:false }],
    ['棒',                         { kana:'ボウ',                             limited:false }],
    ['ほうき',                     { kana:'ホウキ',                           limited:false }],
    ['ママさんダンプ',             { kana:'ママサンダンプ',                   limited:false }],
    ['ムチ',                       { kana:'ムチ',                             limited:false }],
    ['モバイルバッテリー',         { kana:'モバイルバッテリー',               limited:false }],
  // レジストリ（限定武器から常設武器に変更）
    ['狩人罠',                     { kana:'カリウドワナ',                     limited:false }],
    ['狐火閃光',                   { kana:'キツネビセンコウ',                 limited:false }],
    ['投縄網',                     { kana:'ナゲナワアミ',                     limited:false }],
    ['猟犬笛',                     { kana:'リョウケンブエ',                   limited:false }],
    ['パンプキンランチャー',       { kana:'パンプキンランチャー',             limited:false }],
    ['ゴーストネット',             { kana:'ゴーストネット',                   limited:false }],
    ['キャンディコーンブラスター', { kana:'キャンディコーンブラスター',       limited:false }],
    ['魔女のおたま',               { kana:'マジョノオタマ',                   limited:false }],
    ['墓掘りシャベル',             { kana:'ハカホリシャベル',                 limited:false }],
    ['叫ぶランタン',               { kana:'サケブランタン',                   limited:false }],
    ['クモの巣のムチ',             { kana:'クモノスノムチ',                   limited:false }],
    ['呪いの鐘',                   { kana:'ノロイノカネ',                     limited:false }],
    ['コウモリブーメラン',         { kana:'コウモリブーメラン',               limited:false }],
    ['スカルマレット',             { kana:'スカルマレット',                   limited:false }],
  // レジストリ（限定武器）
    ['カエルの拡声器',             { kana:'カエルノカクセイキ',               limited:true  }],
    ['カエルのメガホン',           { kana:'カエルノメガホン',                 limited:true  }],
    ['セミのソニックキャノン',     { kana:'セミノソニックキャノン',           limited:true  }],
    ['花火',                       { kana:'ハナビ',                           limited:true  }],
    ['うちわ',                     { kana:'ウチワ',                           limited:true  }],
    ['練達のバット',               { kana:'レンタツノバット',                 limited:true  }],
    ['練達のバットR',              { kana:'レンタツノバットR',                limited:true  }],
    ['キャンディケインの剣',       { kana:'キャンディケインノケン',           limited:true  }],
    ['スレイストライカー',         { kana:'スレイストライカー',               limited:true  }],
    ['絶氷槍パーマフロスト',       { kana:'ゼツヒョウソウパーマフロスト',     limited:true  }],
    ['凍盲の大鎌',                 { kana:'トウモウノオオガマ',               limited:true  }],
    ['氷縛のポールアックス',       { kana:'ヒョウバクノポールアックス',       limited:true  }],
    ['雹嵐チャクラム',             { kana:'ヒョウランチャクラム',             limited:true  }],
    ['真夜中氷河ランタン',         { kana:'マヨナカヒョウガランタン',         limited:true  }],
    ['凍傷スリング',               { kana:'トウショウスリング',               limited:true  }],
    ['花火R',                      { kana:'ハナビR',                          limited:true  }],
    ['うちわR',                    { kana:'ウチワR',                          limited:true  }],
    ['チョコレートハンマー',       { kana:'チョコレートハンマー',             limited:true  }],
    ['桃花うちわ',                 { kana:'トウカウチワ',                     limited:true  }],
    ['純白報復の大槌',             { kana:'ジュンパクホウフクノオオヅチ',     limited:true  }],
    ['春暁花杖',                   { kana:'シュンギョウカジョウ',             limited:true  }],
    ['石垣穿ちの杭槍',             { kana:'イシガキウガチノクイヤリ',         limited:true  }],
    ['砦吠えの煉瓦砲',             { kana:'トリデボエノレンガホウ',           limited:true  }],
    ['復興の石亀',                 { kana:'フッコウノイシガメ',               limited:true  }],
    ['灰翼',                       { kana:'カイヨク',                         limited:true  }],
  // レジストリ（イベント開催中の限定武器）
  //  ['灰翼',                       { kana:'カイヨク',                         limited:true, eventActive:true  }],
  ]);

  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
  // レジストリ（防具）
  // ※現在イベント中として扱いたい装備には eventActive:true を付与してください
  // 例:
  // ['装備名', { kana:'ソウビメイ', limited:true, eventActive:true }],
  // ['装備名', { kana:'ソウビメイ', category:'event' }],
  // - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

  // レジストリ（常設防具）
  const armorRegistry = new Map([
    ['SPF50+',                     { kana:'SPF50プラス',                      limited:false }],
    ['羽毛のマント',               { kana:'ウモウノマント',                   limited:false }],
    ['割烹着',                     { kana:'カッポウギ',                       limited:false }],
    ['木の鎧',                     { kana:'キノヨロイ',                       limited:false }],
    ['硬化木の鎧',                 { kana:'コウカキノヨロイ',                 limited:false }],
    ['座布団',                     { kana:'ザブトン',                         limited:false }],
    ['たぬきの着ぐるみ',           { kana:'タヌキノキグルミ',                 limited:false }],
    ['段ボールの鎧',               { kana:'ダンボールノヨロイ',               limited:false }],
    ['デカすぎる兜',               { kana:'デカスギルカブト',                 limited:false }],
    ['どんぐりかたびら',           { kana:'ドングリカタビラ',                 limited:false }],
    ['葉っぱの鎧',                 { kana:'ハッパノヨロイ',                   limited:false }],
    ['プチプチ巻き',               { kana:'プチプチマキ',                     limited:false }],
    ['布団',                       { kana:'フトン',                           limited:false }],
    ['防弾カバン',                 { kana:'ボウダンカバン',                   limited:false }],
  // レジストリ（限定防具）
    ['セミの抜け殻',               { kana:'セミノヌケガラ',                   limited:true  }],
    ['水着',                       { kana:'ミズギ',                           limited:true  }],
    ['ゆかた',                     { kana:'ユカタ',                           limited:true  }],
    ['ウサギの耳',                 { kana:'ウサギノミミ',                     limited:true  }],
    ['ウサギの耳R',                { kana:'ウサギノミミR',                    limited:true  }],
    ['猫耳カチューシャ',           { kana:'ネコミミカチューシャ',             limited:true  }],
    ['ナイトロダッシュ',           { kana:'ナイトロダッシュ',                 limited:true  }],
    ['ニトロダッシュ',             { kana:'ニトロダッシュ',                   limited:true  }],
    ['トナカイの装',               { kana:'トナカイノヨソオイ',               limited:true  }],
    ['パンプキン外殻',             { kana:'パンプキンガイガク',               limited:true  }],
    ['墓蝋のヴェール',             { kana:'ハカロウノヴェール',               limited:true  }],
    ['塩結界の外套',               { kana:'シオケッカイノガイトウ',           limited:true  }],
    ['ミイラ包帯',                 { kana:'ミイラホウタイ',                   limited:true  }],
    ['霜鬼のマント',               { kana:'ソウキのマント',                   limited:true  }],
    ['鏡棺',                       { kana:'キョウカン',                       limited:true  }],
    ['灯守の外套',                 { kana:'トウモリノガイトウ',               limited:true  }],
    ['段ボールの鎧R',              { kana:'ダンボールノヨロイR',              limited:true  }],
    ['プチプチ巻きR',              { kana:'プチプチマキR',                    limited:true  }],
    ['葉っぱの鎧R',                { kana:'ハッパノヨロイR',                  limited:true  }],
    ['木の鎧R',                    { kana:'キノヨロイR',                      limited:true  }],
    ['SPF50+R',                    { kana:'SPF50プラスR',                     limited:true  }],
    ['デカすぎる兜R',              { kana:'デカスギルカブトR',                limited:true  }],
    ['どんぐりかたびらR',          { kana:'ドングリカタビラR',                limited:true  }],
    ['氷霜のシュラウド',           { kana:'ヒョウソウノシュラウド',           limited:true  }],
    ['雪崩の甲殻',                 { kana:'ナダレノコウカク',                 limited:true  }],
    ['ツンドラ守護者の胴衣',       { kana:'ツンドラシュゴシャノドウイ',       limited:true  }],
    ['極光の冠兜',                 { kana:'キョッコウノカンムリカブト',       limited:true  }],
    ['月影の告白ゆかた',           { kana:'ツキカゲノコクハクユカタ',         limited:true  }],
    ['乱れ桜の外套',               { kana:'ミダレザクラノガイトウ',           limited:true  }],
    ['白薔薇の誓約鎧',             { kana:'シロバラノセイヤクヨロイ',         limited:true  }],
    ['命護りの春司衣',             { kana:'イノチマモリノハルツカサキヌ',     limited:true  }],
    ['不落城門の鉄岩鎧',           { kana:'フラクジョウモンノテツガンヨロイ', limited:true  }],
    ['昭和残影の作業衣',           { kana:'ショウワザンエイノサギョウイ',     limited:true  }],
    ['火守殻',                     { kana:'ヒモリカク',                       limited:true  }],
    ['地護殻',                     { kana:'チゴカク',                         limited:true  }],
    ['風纏殻',                     { kana:'フウテンカク',                     limited:true  }],
  // レジストリ（イベント開催中の限定防具）
    ['雷嵐殻',                     { kana:'ライランカク',                     limited:true, eventActive:true  }],
  ]);

  // ============================================================
  // 派生構造（互換用：既存コードが参照）
  // ============================================================
  const weaponKana = new Map();
  const armorKana  = new Map();
  const eventWeapon   = new Set();
  const eventArmor    = new Set();
  const limitedWeapon = new Set();
  const limitedArmor  = new Set();
  const weaponKeyToName = new Map();
  const armorKeyToName  = new Map();

  function buildDerivedStructures(){
    // 武器
    for (const [name, meta] of weaponRegistry.entries()){
      const key = makeKey(name);
      if (weaponKeyToName.has(key) && weaponKeyToName.get(key) !== name){
        console.warn('[DBE] weapon name key collision:', name, 'vs', weaponKeyToName.get(key));
      } else {
        weaponKeyToName.set(key, name);
      }
      if (meta && typeof meta.kana === 'string' && meta.kana.trim()){
        weaponKana.set(name, meta.kana.trim());
      }
      const category = normalizeRegistryCategory(meta);
      if (category === 'event'){
        eventWeapon.add(name);
      }
      if (category === 'event' || category === 'limited'){
        limitedWeapon.add(name);
      }
    }
    // 防具
    for (const [name, meta] of armorRegistry.entries()){
      const key = makeKey(name);
      if (armorKeyToName.has(key) && armorKeyToName.get(key) !== name){
        console.warn('[DBE] armor name key collision:', name, 'vs', armorKeyToName.get(key));
      } else {
        armorKeyToName.set(key, name);
      }
      if (meta && typeof meta.kana === 'string' && meta.kana.trim()){
        armorKana.set(name, meta.kana.trim());
      }
      const category = normalizeRegistryCategory(meta);
      if (category === 'event'){
        eventArmor.add(name);
      }
      if (category === 'event' || category === 'limited'){
        limitedArmor.add(name);
      }
    }
  }
  buildDerivedStructures();

  // ============================================================
  // Lock/Unlockリンクの状態をソートするための順位付け
  // ============================================================
  const secrOrder = { 'secured': 0, 'released': 1 };

  // ============================================================
  // 共通定義: SVG矢印（基本サイズ1em、左右余白0.1em）
  // ============================================================
  const ARROW_SVG = {
    up: `<svg xmlns="http://www.w3.org/3000/svg" viewBox="0 0 10 10" width="1em" height="1em" style="vertical-align:middle;margin:0 0.1em"><path d="M1 6 L5 2 L9 6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
    down:`<svg xmlns="http://www.w3.org/3000/svg" viewBox="0 0 10 10" width="1em" height="1em" style="vertical-align:middle;margin:0 0.1em"><path d="M1 4 L5 8 L9 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`
  };

  // ============================================================
  // ソートインジケーター更新ヘルパー
  // ============================================================
  /**
  * @param {HTMLElement} th - ヘッダー th
  * @param {'⬆'|'⬇'} arrow - 矢印
  * @param {'left'|'right'} position - インジケーター位置
  * @param {string=} label - インジケータ内に表示するテキスト（例: 'Rarity','限定','カナ'）
  */

  function updateSortIndicator(th, arrow, position, label) {
    // 既存のインジケーターを全て削除（ヘッダー行内）
    // ※ヘッダー行が clone 置換されるケースでも確実に効くよう closest('tr') を優先
    const headerTr = (th && typeof th.closest === 'function')
      ? th.closest('tr')
      : (th ? th.parentNode : null);
    if (headerTr) {
      headerTr
        .querySelectorAll('.sort-indicator, .sort-indicator-left')
        .forEach(el => el.remove());
    }
    const span = document.createElement('span');

    // 共通クラス付与
    if (position === 'left') {
      span.classList.add('sort-indicator-left');
    } else {
      span.classList.add('sort-indicator');
    }

    // 念のため：CSSが当たらない/上書きされるケースでも最低限見えるように保険
    // （CSS側の定義は維持しつつ、表示されない事故だけ潰す）
    span.style.display = 'inline-flex';
    span.style.alignItems = 'center';
    span.style.gap = '0.1em';
    span.style.color = 'red';
    span.style.fontWeight = 'bold';

    // インジケーター本体
    const svg = ARROW_SVG[ arrow === '⬇' ? 'down' : 'up' ];
    if (label) {
      // (SVG) テキスト の形で表示（ブラケット無し）、テキストは 0.8em
      span.innerHTML = `${svg}<span class="sort-label">${label}</span>`;
    } else {
      // 互換：矢印のみ
      span.innerHTML = svg;
    }

    // thの先頭 or 末尾に挿入
    if (position === 'left') {
      th.insertBefore(span, th.firstChild);
    } else {
      th.appendChild(span);
    }

    // 最終ソートをグローバルに記憶
    const allColumnClasses = [
      ...Object.values(columnIds.necklaceTable),
      ...Object.values(columnIds.weaponTable),
      ...Object.values(columnIds.armorTable),
    ];
    // th に付いている class のうち、columnIds のいずれかを見つける
    const colClass = Array.from(th.classList).find(c => allColumnClasses.includes(c)) || null;
    lastSortedColumn  = colClass;
    // '⬇' を正順、'⬆' を逆順とみなす
    lastSortAscending = (arrow === '⬇');
  }

  // --- 最後に使用したソート関数を記憶するマップ（先に初期化） ---
  const lastSortMap = {};

  // --- ソート履歴（安定ソートの多段復元用） ---
  const lastSortHistoryMap = {};
  const DBE_MAX_SORT_HISTORY = 12;

  function dbeClearSortHistory(id){
    try{ if (lastSortMap && typeof lastSortMap === 'object') lastSortMap[id] = null; }catch(_){}
    try{ lastSortHistoryMap[id] = []; }catch(_){}
  }

  function dbeRememberSort(id, fn, key){
    try{
      if (!fn || typeof fn !== 'function') return;
      // 直近（単発）も保持
      if (lastSortMap && typeof lastSortMap === 'object') lastSortMap[id] = fn;

      // 履歴（多段）も保持
      if (!Array.isArray(lastSortHistoryMap[id])) lastSortHistoryMap[id] = [];
      const arr = lastSortHistoryMap[id];

      // key 指定がある場合：同一キー（＝同一列）の過去履歴を除去して「最後の方向」だけを採用
      if (key != null) {
        for (let i = arr.length - 1; i >= 0; i--) {
          const it = arr[i];
          const itKey = (typeof it === 'function') ? null : (it && typeof it === 'object' ? it.key : null);
          if (itKey === key) arr.splice(i, 1);
        }
        arr.push({ key, fn });
      } else {
        // 互換：key 無しは従来通り（クリック履歴を積む）
        arr.push(fn);
      }

      if (arr.length > DBE_MAX_SORT_HISTORY) {
        arr.splice(0, arr.length - DBE_MAX_SORT_HISTORY);
      }
    }catch(e){
      console.warn('[DBE] rememberSort failed:', e);
    }
  }

  function dbeApplySortHistory(id){
    try{
      const arr = lastSortHistoryMap[id];
      if (Array.isArray(arr) && arr.length){
        // 安定ソート前提：古い順に適用すると、後のソートほど優先度が高くなる
        arr.forEach(it => {
          try{
            if (typeof it === 'function') { it(); return; }
            if (it && typeof it === 'object' && typeof it.fn === 'function') { it.fn(); return; }
          }catch(e){
            console.warn('[DBE] applySortHistory step failed:', e);
          }
        });
        return true;
      }
      if (typeof lastSortMap[id] === 'function') {
        lastSortMap[id]();
        return true;
      }
    }catch(e){
      console.warn('[DBE] applySortHistory failed:', e);
    }
    return false;
  }

  // --- 最後にソートされた列と方向を記憶 ---
  let lastSortedColumn  = null;  // 最後にソートされた列の class 名 (columnIds のいずれか)
  let lastSortAscending = null;  // true=正順(⬇), false=逆順(⬆)

  // --- 状態管理変数 ---
  let lastClickedCellId = null;
  let recycleTableId    = null;
  let recycleItemId     = null;

  // ============================================================
  // 工作センター（/craft）
  // - 「資源パックを開ける」/「鉄のキーを作れ。」/「大砲の玉を作れ。」の通常フォーム送信を fetch 化
  // - サーバーから返る「作成成功」/「作成に失敗しました」をページ遷移なしでダイアログ表示
  // - /keyshop へ遷移する応答は「鉄のキー」が足りない旨のダイアログとして表示
  // - OK 押下で /craft を再読み込み
  // ============================================================
  if (location.pathname === '/craft') {
    function dbeEnsureCraftDialogStyle(){
      try{
        if (document.getElementById('dbe-craft-dialog-style')) return;
        const style = document.createElement('style');
        style.id = 'dbe-craft-dialog-style';
        style.textContent = `
          .dialogCommon{
            background-color:#F6FFFF;
            border:6px solid #009300;
            border-radius:10px;
            padding:4px;
            color:#000;
            box-shadow:inset 0 0 0 3px rgba(153,0,0,0.2);
          }
        `;
        document.head.appendChild(style);
      }catch(_){}
    }

    function dbeNormalizeCraftResponseText(rawText){
      try{
        const raw = String(rawText || '').trim();
        if (!raw) return '';

        let text = raw;
        if (/<[a-z][\s\S]*>/i.test(raw)){
          const doc = new DOMParser().parseFromString(raw, 'text/html');
          text = (doc.body && doc.body.textContent ? doc.body.textContent : raw).trim();
        }

        if (/作成成功/.test(text)) return '作成成功';
        if (/作成に失敗しました/.test(text)) return '作成に失敗しました';

        return text
          .replace(/\r/g, '')
          .replace(/[ \t]+\n/g, '\n')
          .replace(/\n{3,}/g, '\n\n')
          .trim()
          .slice(0, 300);
      }catch(_){
        return String(rawText || '').trim().slice(0, 300);
      }
    }

    function dbeShowCraftResultDialog(titleText, messageText){
      try{
        dbeEnsureCraftDialogStyle();

        const wndID = 'dbe-Dialog-CraftResult';
        const wnd = ensureWindowShell(wndID);
        wnd.classList.remove('dialogAlert', 'dialogAlertLite');
        wnd.classList.add('dialogCommon');
        Object.assign(wnd.style, {
          borderRadius: '10px',
          padding: '1em'
        });

        const closeBtn = wnd.firstElementChild;
        if (closeBtn && closeBtn.tagName === 'BUTTON') {
          closeBtn.style.display = 'none';
          closeBtn.disabled = true;
        }

        Array.from(wnd.children).forEach((ch, i)=>{
          if (i > 0) ch.remove();
        });

        const wrap = document.createElement('div');
        Object.assign(wrap.style, {
          display: 'grid',
          gap: '12px',
          minWidth: 'min(84vw, 320px)',
          maxWidth: '64ch',
          padding: '0.25em 0.5em'
        });

        const line1 = document.createElement('div');
        line1.textContent = String(titleText || '').trim();
        Object.assign(line1.style, {
          textAlign: 'left',
          fontWeight: '700',
          fontSize: '1.05em'
        });

        const line2 = document.createElement('div');
        line2.textContent = String(messageText || '').trim();
        Object.assign(line2.style, {
          textAlign: 'center',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          lineHeight: '1.6',
          fontSize: '1.05em',
          margin: '0.25em 0'
        });

        const line3 = document.createElement('div');
        Object.assign(line3.style, {
          textAlign: 'center'
        });

        const ok = document.createElement('button');
        ok.textContent = 'OK';
        Object.assign(ok.style, {
          cursor: 'pointer',
          padding: '6px 20px',
          border: '2px solid #006600',
          borderRadius: '6px',
          background: '#E9FFE9',
          display: 'inline-block',
          margin: '0.25em auto 0 auto'
        });
        ok.addEventListener('click', ()=>{
          try{
            wnd.style.display = 'none';
            window.location.href = DBE_ORIGIN + '/craft';
          }catch(_){
            location.reload();
          }
        });

        line3.appendChild(ok);
        wrap.append(line1, line2, line3);
        wnd.appendChild(wrap);

        dbeBringDialogToFront(wnd);
        wnd.style.display = 'block';
        try{ setTimeout(()=>ok.focus(), 0); }catch(_){}
      }catch(err){
        console.error('[DBE] dbeShowCraftResultDialog error:', err);
        alert(String(titleText || '').trim() + '\n' + String(messageText || '').trim());
        try{ window.location.href = DBE_ORIGIN + '/craft'; }catch(_){}
      }
    }

    function dbeInitCraftFormOne(config){
      try{
        if (!config) return;
        const forms = Array.from(document.querySelectorAll('form[action]'));
        const form = forms.find(f => {
          try{
            const action = new URL(f.getAttribute('action') || f.action || '', location.href);
            if (action.pathname !== config.path) return false;
            const submit = f.querySelector('input[type="submit"], button[type="submit"], button:not([type])');
            const label = submit ? (submit.value || submit.textContent || '').trim() : '';
            return label === config.submitLabel;
          }catch(_){
            return false;
          }
        });
        if (!form || form.dataset[config.hookedKey] === '1') return;
        form.dataset[config.hookedKey] = '1';

        form.addEventListener('submit', async (ev)=>{
          ev.preventDefault();
          ev.stopPropagation();

          const submitter = ev.submitter || form.querySelector('input[type="submit"], button[type="submit"], button:not([type])');
          const oldDisabled = submitter ? !!submitter.disabled : false;
          if (submitter) submitter.disabled = true;

          try{
            const action = new URL(form.getAttribute('action') || form.action || config.path, location.href);
            const resp = await fetch(action.href, {
              method: 'POST',
              body: new FormData(form),
              credentials: 'same-origin',
              headers: {
                'Accept': 'text/plain, text/html, */*'
              }
            });

            const finalUrl = (() => {
              try{
                return new URL(resp.url || action.href, location.href);
              }catch(_){
                return null;
              }
            })();
            if (config.keyshopAsIronKeyShortage && finalUrl && finalUrl.pathname === '/keyshop'){
              dbeShowCraftResultDialog(config.dialogTitle, '「鉄のキー」が足りません');
              return;
            }

            const raw = await resp.text();
            const message = dbeNormalizeCraftResponseText(raw) || '応答を取得できませんでした。';
            dbeShowCraftResultDialog(config.dialogTitle, message);
          }catch(err){
            console.warn('[DBE] craft request failed:', config.path, err);
            dbeShowCraftResultDialog(config.dialogTitle, '通信に失敗しました。');
          }finally{
            if (submitter) submitter.disabled = oldDisabled;
          }
        }, true);
      }catch(err){
        console.warn('[DBE] init craft form failed:', err);
      }
    }

    function dbeInitCraftForms(){
      dbeInitCraftFormOne({
        path: '/craft/resource',
        submitLabel: '資源パックを開ける',
        dialogTitle: '資源パックを開ける：',
        hookedKey: 'dbeCraftResourceHooked',
        keyshopAsIronKeyShortage: true
      });
      dbeInitCraftFormOne({
        path: '/craft/key',
        submitLabel: '鉄のキーを作れ。',
        dialogTitle: '「鉄のキー」を作る：',
        hookedKey: 'dbeCraftKeyHooked'
      });
      dbeInitCraftFormOne({
        path: '/craft/cannonball',
        submitLabel: '大砲の玉を作れ。',
        dialogTitle: '「鉄の大砲の玉」を作る：',
        hookedKey: 'dbeCraftCannonballHooked'
      });
    }


    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', dbeInitCraftForms);
    } else {
      dbeInitCraftForms();
    }
    return;
  }

  // ============================================================
  // Transfer ページ用: DBE 本体処理の対象外
  // - 送信先IDの自動入力は廃止
  // - 旧版で残った自動入力フラグだけ掃除して終了する
  // ============================================================
  if (location.pathname === '/transfer') {
    try{ dbeStorage.removeItem('donguriAutoTransfer'); }catch(_){}
    return;
  }

  // ============================================================
  // アイテムウォッチ（https://donguri.5ch.io/itemwatch）
  // - header 直下の <p style="text-align:center;margin:0 auto;"></p> の「前」に
  //   チェックボックス「自分だけ抽出」を挿入
  // - ON のとき、表の「アイテム保持者の名前」列が localStorage['donguri-name'] と完全一致する行だけ表示
  // - OFF のとき、デフォルト表示に戻す
  // - チェック状態は localStorage に永続化
  // ============================================================
  if (location.pathname === '/itemwatch') {
    window.addEventListener('load', ()=>{
      try{
        const KEY_SELFONLY = 'dbe-itemwatch-selfonly';

        const header = document.querySelector('header');
        if (!header) return;

        // header 直下の <p style="text-align:center;margin:0 auto;"></p>
        // （style の完全一致は避け、text-align:center を含む p を優先）
        const pAfterHeader = header.nextElementSibling
          && header.nextElementSibling.tagName === 'P'
          ? header.nextElementSibling
          : null;
        const p = pAfterHeader || document.querySelector('header + p');
        if (!p) return;

        // donguri-name（保存値）が無い場合は、UIを出さず、機能も無効（＝表示をデフォルトへ）
        const savedName = (localStorage.getItem('donguri-name') || '').trim();

        // 対象テーブル（基本的に p の直下に table がある想定）
        const table =
          (p && p.querySelector && p.querySelector('table')) ||
          document.querySelector('header + p table') ||
          document.querySelector('table');
        if (!table) return;

        function findHolderNameColIndex(tbl){
          try{
            const ths = Array.from(tbl.querySelectorAll('thead th'));
            if (!ths.length) return -1;
            const idx = ths.findIndex(th => {
              const t = (th.textContent || '').trim();
              return t === 'アイテム保持者の名前';
            });
            return idx;
          }catch(_){
            return -1;
          }
        }

        function applySelfOnly(on){
          try{
            const myName = (dbeStorage.getItem('donguri-name') || '').trim();
            const idx = findHolderNameColIndex(table);
            const body = table.tBodies && table.tBodies[0];
            if (!body) return;

            // myName が無い/列が無い場合でも、OFF は確実に復元
            Array.from(body.rows).forEach(tr=>{
              if (!tr) return;
              if (!('dbeOrigDisplay' in tr.dataset)) {
                tr.dataset.dbeOrigDisplay = tr.style.display || '';
              }
              if (!on) {
                tr.style.display = tr.dataset.dbeOrigDisplay || '';
                return;
              }
              if (idx < 0 || !myName) {
                // 条件が満たせない場合は「何も隠さない」（ユーザー混乱防止）
                tr.style.display = tr.dataset.dbeOrigDisplay || '';
                return;
              }
              const td = tr.cells && tr.cells[idx];
              const holder = (td ? (td.textContent || '') : '').trim();
              tr.style.display = (holder === myName) ? (tr.dataset.dbeOrigDisplay || '') : 'none';
            });
          }catch(e){
            console.warn('[DBE] itemwatch self-only filter failed:', e);
          }
        }

        // 保存値が無いなら、UIは非表示（未生成）＆確実にデフォルト表示へ戻して終了
        if (!savedName) {
          const wrap0 = document.getElementById('dbe-itemwatch-selfonly-wrap');
          if (wrap0) wrap0.style.display = 'none';
          applySelfOnly(false);
          return;
        }

        // すでに挿入済みなら二重挿入しない（ただし表示は復帰）
        if (document.getElementById('dbe-itemwatch-selfonly-wrap')) {
          const wrap1 = document.getElementById('dbe-itemwatch-selfonly-wrap');
          if (wrap1) wrap1.style.display = 'flex';
        } else {
          const wrap = document.createElement('div');
          wrap.id = 'dbe-itemwatch-selfonly-wrap';
          wrap.style.cssText = [
            'display:flex',
            'justify-content:center',
            'align-items:center',
            'gap:8px',
            'margin:0 auto',
            'padding:6px 0',
            'max-width:100%',
          ].join(';');

          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.id = 'dbe-itemwatch-selfonly';

          const label = document.createElement('label');
          label.setAttribute('for', cb.id);
          label.textContent = '自分だけ抽出';
          label.style.cssText = 'cursor:pointer; user-select:none;';

          wrap.appendChild(cb);
          wrap.appendChild(label);

          // 「header」と「p」の間に挿入
          p.parentNode.insertBefore(wrap, p);
        }

        const cb = document.getElementById('dbe-itemwatch-selfonly');
        if (!cb) return;

        // 永続状態の復元
        cb.checked = (dbeStorage.getItem(KEY_SELFONLY) === '1');
        applySelfOnly(cb.checked);

        cb.addEventListener('change', ()=>{
          const on = !!cb.checked;
          dbeStorage.setItem(KEY_SELFONLY, on ? '1' : '0');
          applySelfOnly(on);
        });
      }catch(e){
        console.warn('[DBE] init itemwatch failed:', e);
      }
    });
    return;
  }

  // ============================================================
  // 初期化処理
  // ============================================================
  function initAll(){
    // --- 関数呼び出し ---
    replaceTreasureLinks();
    insertItemSummary();

    (function insertEquippedSection(){
      const header = document.querySelector('header');
      if (!header) return;
      // 見出しの挿入
        header.insertAdjacentHTML('afterend',
          '<h2 style="font-size:1.5em; margin-top:1em;"><span style="color:red;">&block;</span> 装備中のアイテム</h2>'
        );
        document.querySelectorAll('h3').forEach(h3 => {
          const text = h3.textContent.trim();
          if (!text.includes('装備している')) return;
          // ★(1) 「この h3 の次の兄弟要素」から順にたどって先に見つかった <table> 要素を拾う
          let el = h3.nextElementSibling;
          while (el && el.tagName !== 'TABLE') {
            // <p>／<div> の中に table があればそれを使う
            if ((el.tagName === 'P' || el.tagName === 'DIV')
                && el.querySelector('table')) {
                el = el.querySelector('table');
                break;
                }
            el = el.nextElementSibling;
          }
          const table = (el && el.tagName === 'TABLE') ? el : null;
          if (!table) {
            console.warn('装備中テーブルが見つかりません:', text, h3);
            h3.remove();
            return;
          }

          // ★(2.5) 装備中テーブルの ELEM 列（/属性列）を着色
          function applyColor(){
            try{
              const body = table.tBodies && table.tBodies[0];
              if (!body) return;
              const elemIdx = findHeaderIndexByText(table, ['ELEM','属性','Elem','Element','属性/Element']);
              if (elemIdx < 0) return;
              Array.from(body.rows).forEach(r=>{
                const td = r.cells[elemIdx];
                if (!td) return;
                const raw = (td.textContent || '').trim();
                const elem = (raw.match(/[^\d]+$/) || ['なし'])[0].trim();
                td.style.backgroundColor = elemColors[elem] || '';
              });
            }catch(_){}
          }

          // ★(2) テキストに応じて ID を振る
          if (text.includes('ネックレス')) {
            table.id = 'necklaceEquipped';
          } else if (text.includes('防具')) {
            table.id = 'armorEquipped';
          } else if (text.includes('武器')) {
            table.id = 'weaponEquipped';
          }
          applyColor();
          if (text.includes('ネックレス')) {
            try{ dbeApplyNecklaceDebuffColoring(table); }catch(_){}
          }
        // 見出し自体はもう不要なので削除
        h3.remove();
      });
    })();

    // --- 「アイテムバッグ」見出しの整理 ---
    (function replaceBagHeading(){
      const headings = Array.from(document.querySelectorAll('h1, h3'))
          .filter(el => el.textContent.trim().startsWith('アイテムバッグ'));
      if (headings.length < 2) return;
      const old = headings[1];
      const h2 = document.createElement('h2');
      h2.style.fontSize  = '1.5em';
      h2.style.marginTop = '1em';
      h2.innerHTML = '<span style="color:red;">&block;</span> 所持アイテム一覧';
      old.replaceWith(h2);
    })();

    // ============================================================
    // ▽ここから▽ スタイル（CSS）集中管理ブロック
    // ------------------------------------------------------------
    const style = document.createElement('style');
      style.textContent = `
      /* --- Pタグのマージンをクリア --- */
      p {
        margin-top:    unset;
        margin-right:  unset;
        margin-bottom: unset;
        margin-left:   unset;
      }

      /* --- どんぐりバッグの画像を右寄せ --- */
      @media (min-width:300px) {
        img[src*="acorn-bag.jpg"] {
          float: right;
          margin: 0 0 1em 1em;
          max-width: 40%;
        }
      }

      /* --- ページ上の「全て分解する」ボタンにのみ適用 --- */
      form[action$="/recycleunlocked"] > button {
        display: block;
        margin: 8px auto;
        font-size: 1em;
        padding: 4px 8px;
      }

      /* --- 宝箱リンク用のリストレイアウト --- */
      ul#treasurebox {
        list-style: none;
        padding: 0;
        margin: 0 auto;
        display: flex;
        justify-content: center;
        gap: 1em;
        flex-wrap: wrap;
        font-size: 1.2em;
        font-weight: bold;
      }

      /* --- 装備中テーブルの幅とマージンを整形 --- */
      table#weaponEquipped,
      table#armorEquipped,
      table#necklaceEquipped {
        min-width: 100%;
        margin: 0px auto 12px 0px;
      }

      /* --- ソートインジケーター定義 --- */
      .sort-indicator,
      .sort-indicator-left {
        display: inline-block;
        margin: 0;
        padding: 0;
        transform-origin: center center;
        color: red;
        font-weight: bold;
      }
      /* ソートラベルの文字サイズ（インジケーター内） */
      .sort-label {
        font-size: 0.8em;
        vertical-align: middle;
      }

      /* --- ネックレス「属性」列（DeBuff）：末尾文言／簡易表示のマイナス値を赤く --- */
      .dbe-nec-debuff {
        color: red;
      }
      .dbe-nec-attr-minus {
        color: red;
      }

      /* --- 強制表示用：フィルターUI と バーガーメニュー --- */
      .filter-ui {
        display: flex !important;
        flex-direction: column !important;
        visibility: visible !important;
        opacity: 1 !important;
      }

      /* --- カラーパレット呼び出しボックスの隙間除去（id 指定で限定適用） --- */
      #dbe-prm-panel0-setcolor-cell-unlocked,
      #dbe-prm-panel0-setcolor-cell-locked {
        /* ブラウザ既定の余白を無効化 */
        appearance: none;
        -webkit-appearance: none;
        padding: 0;
      }
      /* WebKit の内側ラッパ余白を0に */
      #dbe-prm-panel0-setcolor-cell-unlocked::-webkit-color-swatch-wrapper,
      #dbe-prm-panel0-setcolor-cell-locked::-webkit-color-swatch-wrapper {
        padding: 0;
      }
      /* 内側スウォッチの枠を消して全面表示 */
      #dbe-prm-panel0-setcolor-cell-unlocked::-webkit-color-swatch,
      #dbe-prm-panel0-setcolor-cell-locked::-webkit-color-swatch {
        border: none;
      }
      #dbe-prm-panel0-setcolor-cell-unlocked::-moz-color-swatch, #dbe-prm-panel0-setcolor-cell-locked::-moz-color-swatch { border: none; }

      /* "dbe-W-Rules"ウインドウのタブ（武器/防具）を 8em 固定幅に */
      .dbe-tab {
        width: 8em !important;
        display: inline-block;
        text-align: center;
      }

      /* === ▽ここから▽ フィルタカード新規フォーム 共通 === */
      .fc-card {
        border: 3px solid #999;
        border-radius: 8px;
        padding: 8px;
        display: grid;
        gap: 8px;
      }
      /* 枠線の“外側”に見せるフッター（案内＋保存/キャンセル） */
      .fc-footer{
        margin-top: 6px;
        padding-top: 4px;
        display: flex;
        flex-direction: column; /* ← 1行目：案内、2行目：ボタン群 */
        align-items: stretch;   /* ← 子を横幅いっぱいに */
        gap: 6px;               /* 行間 */
      }
      .fc-footer .fc-note{
        font-size: 0.95em;
        opacity: .9;
        margin: 0;              /* 余計な左右マージンを排除 */
      }
      /* ボタン群は横並び＆折返し可 */
      .fc-ops{
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      .fc-grid {
        display: grid;
        grid-template-columns: 8em minmax(10em, 1fr); /* 左ラベル列(固定8.5em) / 右入力列 */
        column-gap: 12px;
        row-gap: 8px;
        align-items: start;
      }
      .fc-row {
        display: contents; /* 各rowは2セル（左/右）を持つ。構成変更しやすいよう分離 */
      }
      .fc-left {
        align-self: start;
      }
      .fc-right {
        align-self: start;
      }
      .fc-title {
        font-size: 1.1em;
        font-weight: 700;
      }
      .fc-sec {
        font-size: 1.1em;
        font-weight: 600;
      }
      .fc-inline {
        display: inline-flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 0.3em;
      }
      .fc-input,
      .fc-select,
      .fc-textarea {
        font-size: 0.95em;
        font-weight: 400;
        padding: 1px 8px;              /* 要件：padding 1px 8px */
      }
      /* 武器名／防具名を定義済みリストから設定するボタン */
      .fc-preset-btn{
        font-size: 0.9em;
        padding: 3px 8px;
        margin: 0 0 4px 0;
        justify-self: start;     /* 右ペインの左寄せ（境界側） */
        align-self: start;
        white-space: nowrap;
      }
      /* Name registry picker window */
      .dbe-namepicker{
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 8px 10px 10px 10px;
        min-width: min(520px, 92vw);
      }
      .dbe-namepicker-head{
        display:flex;
        align-items:flex-end;
        justify-content:space-between;
        gap: 10px;
        padding-right: 6px; /* ×ボタン余白（sticky）に少し余裕 */
      }
      .dbe-namepicker-title{
        font-weight: 700;
        font-size: 1.05em;
      }
      .dbe-namepicker-ops{
        display:flex;
        align-items:center;
        gap: 8px;
      }
      .dbe-namepicker-list{
        border: 1px solid #CCC;
        border-radius: 10px;
        padding: 8px 10px;
        max-height: min(60vh, 520px);
        overflow: auto;
        background: #FFF;
      }
      .dbe-namepicker-item{
        display:flex;
        align-items:center;
        gap: 8px;
        padding: 2px 0;
        user-select:none;
      }
      .dbe-namepicker-item input{
        flex: 0 0 auto;
      }
      .dbe-namepicker-foot{
        display:flex;
        justify-content:center;
        padding-top: 2px;
      }
      .dbe-namepicker-foot button{
        font-size: 0.95em;
        padding: 4px 12px;
      }
      /* Name registry picker window: 未定義リスト */
      .dbe-namepicker-undefTitle{
        font-weight: 700;
        font-size: 1.02em;
        margin: 2px 0 0 2px;
      }
      .dbe-namepicker-undefList{
        border: 1px solid #CCC;
        border-radius: 10px;
        padding: 8px 10px;
        max-height: min(28vh, 220px);
        overflow: auto;
        background: #FFF;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .dbe-namepicker-undefRow{
        display:flex;
        align-items:center;
        gap: 8px;
      }
      .dbe-namepicker-undefInput{
        width: 100%;
        font-size: 0.95em;
        padding: 2px 8px;
        box-sizing: border-box;
      }
      .dbe-namepicker-undefDel{
        flex: 0 0 auto;
        font-size: 1.05em;
        line-height: 1em;
        padding: 2px 10px;
        border-radius: 8px;
      }
      .dbe-namepicker-undefAdd{
        align-self: stretch;
        width: 100%;
        box-sizing: border-box;
        font-size: 1.05em;
        line-height: 1em;
        padding: 2px 10px;
        border-radius: 8px;
      }
      /* パラメータ（名称／SPD／WT.／マリモ）だけ 0.9em に */
      .fc-param-text{
        font-size: 0.9em;
      }
      /* ==== Rarity badges ==== */
      .rar-badge{
        display: inline-block;
        min-width: 3.5em;
        padding: 0 6px;
        border: 2px solid #666;
        border-radius: 6px;
        font-size: 1.1em;
        font-weight: 700;
        line-height: 1.3em;
        margin-right: 1px;
        color: #FFF;
        text-align: center;
        vertical-align: middle;
      }
      .rar-UR  { background-color: #F45D01; color: #FFF; padding: 2px 4px; border: 1px solid #AAA; border-radius: 4px; } /* 既出指定に準拠 */
      .rar-SSR { background-color: #A633D6; color: #FFF; padding: 2px 4px; border: 1px solid #AAA; border-radius: 4px; }
      .rar-SR  { background-color: #1E88E5; color: #FFF; padding: 2px 4px; border: 1px solid #AAA; border-radius: 4px; }
      .rar-R   { background-color: #2E7D32; color: #FFF; padding: 2px 4px; border: 1px solid #AAA; border-radius: 4px; }
      .rar-N   { background-color: #9E9E9E; color: #FFF; padding: 2px 4px; border: 1px solid #AAA; border-radius: 4px; }
      /* ==== Logic badges (AND/OR) ==== */
      .logic-badge{
        display: inline-block;
        min-width: 3em;
        padding: 0 6px;
        border: 2px solid #666;
        border-radius: 6px;
        font-size: 1.1em;
        font-weight: 700;
        line-height: 1.2em;
        margin-right: 1px;
        color: #FFF;
        text-align: center;
        vertical-align: middle;
      }
      .logic-AND { background-color: blue; color: #FFF; padding: 2px 4px; border: 1px solid #AAA; border-radius: 4px; }
      .logic-OR  { background-color: red;  color: #FFF; padding: 2px 4px; border: 1px solid #AAA; border-radius: 4px; }
      /* ==== Element badges ==== */
      .elem-badge{
        display: inline-block;
        padding: 2px 8px;
        border: 1px solid #666;
        border-radius: 6px;
        font-size: 0.9em;
        font-weight: 700;
        line-height: 1.6;
        margin-right: 1px;
        color: var(--elem-fg, #000);            /* 文字色はCSS変数で（既定は黒） */
        background: var(--elem-bg, #eee);       /* 背景はCSS変数 */
        vertical-align: middle;
      }
      .fc-textarea {
        min-height: 5.5em;
        width: min(72svw, 560px);
        resize: vertical;              /* 縦横サイズ可変要件に合わせて縦リサイズ */
      }
      .fc-note {
        font-size: 0.85em;
        opacity: 0.85;
      }
      .fc-dimmed {
        color: #AAA !important;        /* ホワイトアウト（文字色） */
      }
      .fc-dimmed input,
      .fc-dimmed select,
      .fc-dimmed textarea,
      .fc-dimmed label {
        color: #AAA !important;        /* ラベルやプレーンテキストも薄色に */
      }
      /* 入力系（テキスト/数値/セレクト/テキストエリア）の背景と枠線も薄色に */
      .fc-dimmed .fc-input,
      .fc-dimmed .fc-select,
      .fc-dimmed .fc-textarea,
      .fc-dimmed input[type="text"],
      .fc-dimmed input[type="number"],
      .fc-dimmed select,
      .fc-dimmed textarea {
        background-color: #EEEEEE !important; /* #AAA 系の白飛ばし感（視覚弱めのグレー） */
        border-color: #AAAAAA !important;
        color: #AAAAAA !important;
      }
      /* チェックボックス/ラジオの外観も薄色に（見た目のみ） */
      .fc-dimmed input[type="checkbox"],
      .fc-dimmed input[type="radio"] {
        /* 主要ブラウザ対応のトーン変更 */
        accent-color: #AAAAAA !important;
        /* 補助（未対応ブラウザ向けの見た目弱グレー化） */
        filter: grayscale(100%) brightness(10);
      }
      /* 「すべて」チェックのラベルを標準フォントに統一 */
      .fc-all-label{
        font-size: 1em;
        font-weight: 400; /* = normal */
      }
      .fc-actions {
        display: grid;
        grid-template-columns: 1fr 1fr; /* 左：初期化 / 右：追加する */
        gap: 8px;
      }
      .fc-actions .left,
      .fc-actions .right {
        display: flex;
        align-items: center;
      }
      .fc-actions .left  { justify-content: flex-start; }
      .fc-actions .right { justify-content: flex-end;   }
      /* ボタン行を中央寄せにする修飾クラス */
      .fc-ops--center{
        justify-content: center;
        width: 100%;            /* ← 横幅を持たせて中央寄せを効かせる */
      }
      /* パラメータ見出し《…》だけを小さくする */
      .fc-param-head {
        font-size: 0.9em;
      }
      /* section separator: 外枠色で1px、幅7割、中央寄せ */
      .fc-sep {
        height: 0;
        border-top: 1px solid var(--fc-border, #CCC);
        width: 85%;
        margin: 0 auto; /* 中央寄せ */
      }
      /* グリッド内に入れる区切り線（左右2カラムを横断） */
      .fc-sep-row {
        height: 0;
        border-top: 1px solid var(--fc-border, #999);
        width: 90%;
        margin: 0 auto; /* 中央寄せ */
        grid-column: 1 / -1; /* 左右2カラムをまたぐ */
      }
      /* セパレータ（タイプA/B）
        - A: 太さ/幅は現状、色だけ薄く（opacityで薄色化）
        - B: 太さ/色は現状、幅を長く
      */
      .fc-sep-row--a{
        opacity: 0.75;
      }
      .fc-sep-row--b{
        width: 97%;
        border-width: 3px;
        border-color: #999;
        margin: 0.5em 0;
      }
      /* 《マリモ》行のテキストボックス専用クラス（どのブラウザでも効く） */
      .mrm-input{ width: 10em !important; }

      /* ===== フィルタカード設定ウインドウ ===== */
      #dbe-W-Rules {
      min-width: 720px;
      }
      /* Filter Card builder: tighten control-to-label spacing */
      #dbe-W-Rules .dbe-filter-card-builder label {
        display: inline-flex;
        align-items: center;
        gap: 0;
      }
      #dbe-W-Rules .dbe-filter-card-builder input[type="checkbox"],
      #dbe-W-Rules .dbe-filter-card-builder input[type="radio"] {
        margin: 0 !important;   /* ← ブラウザ既定の左右マージンを打ち消して 0px に統一 */
        vertical-align: middle;
      }
      /* 既存の label 内 span やテキストノードとの隙間をさらに詰めたい場合の保険 */
      #dbe-W-Rules label > span,
      #dbe-W-Rules label > i,
      #dbe-W-Rules label > b,
      #dbe-W-Rules label > em {
        margin-left: 0 !important;
      }
      /* 万一、古いCSSで .label や .form-row に大きな gap/margin がある場合の打ち消し */
    #dbe-W-Rules .dbe-filter-card-builder .form-row,
    #dbe-W-Rules .dbe-filter-card-builder .label,
    #dbe-W-Rules .dbe-filter-card-builder .field {
        gap: 0 !important;
      }

      /* ===== Rules: 指定ラベルだけ input を上寄せに揃える ===== */
      #dbe-W-Rules .va-top input[type="checkbox"],
      #dbe-W-Rules .va-top input[type="radio"] {
        vertical-align: top !important;
      }
      /* ===== Rules: va-top ラベルのテキストを 5px 上へシフト ===== */
      #dbe-W-Rules .va-top .va-shift {
        position: relative;
        top: -5px;     /* ← テキストを 5px 上げる */
      }
      /* ===== dbe-W-Rules: Accordion (注意書き) ===== */
      #dbe-W-Rules details.dbe-acc {
        margin: 8px 0 16px 0;
        padding: 6px 8px;
        border: 2px solid #FF0000;
        border-radius: 6px;
        background: #F6FFFF; /* 既存ウィンドウ色に合わせた薄水色 */
      }
      #dbe-W-Rules details.dbe-acc > summary {
        cursor: pointer;
        font-weight: 600;
        outline: none;
        list-style: none; /* Firefox などで summary の黒丸を消す */
      }
      /* WebKit のデフォルトマーカーも消してテキストのみ表示 */
      #dbe-W-Rules details.dbe-acc > summary::-webkit-details-marker { display: none; }
      /* 展開中のボディ領域 */
      #dbe-W-Rules details.dbe-acc[open] .dbe-acc-body {
        margin: 0 0 8px 0;
      }
      /* #dbe-W-Backup の段の間の余白指定 */
    #dbe-W-Backup { --dbe-backup-row-gap: 24px; }
      /* 左列《…》の改行禁止 */
      .fc-left {white-space: nowrap;}

      /* === △ここまで△ フィルタカード新規フォーム 共通 === */

      /* === 旧フォームの無力化（新フォームコンテナ内では旧要素を全て非表示） === */
      /* 新フォームの描画先に data-fc-new="1" を付与し、そこでは .fc-card 以外を出さない */
      .dbe-window-body[data-fc-new="1"] > :not(.fc-card) { display: none !important; }
      /* 念のため、良くある旧フォームのクラス/目印を潰す（存在すれば） */
      .dbe-window-body[data-fc-new="1"] .legacy-filter-form,
      .dbe-window-body[data-fc-new="1"] .old-filter-form,
      .dbe-window-body[data-fc-new="1"] .rule-form-legacy { display: none !important; }

      /* === ▽ここから▽ 既存フィルタカード一覧 用 === */
      .saved-filter-card{ padding:6px 8px; border:1px solid #ccc; border-radius:8px; background:var(--dbe-fc-bg, #fff); margin:6px 0; }
      .saved-filter-line{ line-height:1.6; word-break:keep-all; }
      /* 既存カード行：ネックレス／武器／防具の各フィルタカードに異なる背景色を設定する */
      #dbe-W-Rules{
        --dbe-fc-bg-nec:#F9F9F0; /* ネックレス */
        --dbe-fc-bg-wep:#FCF8F8; /* 武器 */
        --dbe-fc-bg-amr:#F6FFF6; /* 防具 */
      }
      #dbe-W-Rules .dbe-filter-card-row--nec{ --dbe-fc-bg:var(--dbe-fc-bg-nec); }
      #dbe-W-Rules .dbe-filter-card-row--wep{ --dbe-fc-bg:var(--dbe-fc-bg-wep); }
      #dbe-W-Rules .dbe-filter-card-row--amr{ --dbe-fc-bg:var(--dbe-fc-bg-amr); }
      /* === △ここまで△ 既存フィルタカード一覧 用 === */

      /* === ▽ここから▽ 保存完了ダイアログ === */
      .dbe-save-overlay{
        position: fixed; inset: 0;
        background: rgba(0,0,0,.25);
        z-index: 2147483647 !important; /* ほぼ最上位に */
        display: flex; align-items: center; justify-content: center;
      }
      .dbe-save-dialog{
        background: #fff;
        border: var(--dbe-frame-width, 1px) var(--dbe-frame-style, solid) var(--dbe-frame-color, #aaa);
        border-radius: var(--dbe-frame-radius, 10px);
        min-width: 260px; max-width: 80vw;
        padding: 16px 18px; box-shadow: 0 10px 30px rgba(0,0,0,.25);
        display: grid; gap: 12px; text-align: center;
        z-index: 2147483647 !important;
      }
      .dbe-save-title{ font-weight: 700; }
      .dbe-save-actions{ display:flex; justify-content:center; }
      .dbe-save-actions > button{
        padding: 6px 14px; border: 1px solid #888; border-radius: 8px; background:#fafafa;
        cursor: pointer;
      }
      /* === △ここまで△ 保存完了ダイアログ === */

      /* === ▽ここから▽ ダイアログ共通スキン（クラス付けで切替） === */
      /*
        dialogCommon = 通常の確認/情報/小ウインドウ
        dialogAlert  = アラート/エラー/要注意（confirm/二択なども含む）
        ※ ウインドウ本体（ensureWindowShellのdiv）や、独自ダイアログ本体要素に付与
      */
      .dialogCommon{
        /* 基本デザイン（必要に応じてここを差し替え） */
        background-color: #F6FFFF;
        border: 6px solid #009300;
        border-radius: 10px;
        padding: 4px;
        color: #000;
        /* 視覚的な“注意枠”感を少しだけ足す */
        box-shadow: inset 0 0 0 3px rgba(153,0,0,0.2);
      }
      .dialogAlert{
        /* 目立つ注意喚起カラー。必要ならここで強調度を調整 */
        background-color: #FFF9F9;
        border: 6px solid #FF0000;
        border-radius: 10px;
        padding: 4px;
        color: rgb(2, 2, 2);
        /* 視覚的な“注意枠”感を少しだけ足す */
        box-shadow: inset 0 0 0 3px rgba(153,0,0,0.2);
      }
      /* “条件がすべて/不問のみ” 保存禁止アラート用（軽めの赤枠） */
      .dialogAlertLite{
        background-color: #FFF9F9;
        border: 3px solid #B00000;
        border-radius: 10px;
        padding: 4px;
        color: #300;
        box-shadow: inset 0 0 0 3px rgba(153,0,0,0.2);
      }
      /* === △ここまで△ ダイアログ共通スキン === */

      /* === ▽ここから▽ 二択確認ダイアログ（共通） === */
      /* 役割クラス（confirmCommon / confirmAlert）は、ウインドウ本体(ensureWindowShell生成div)に付与 */
      .confirm-title {
        font-size:1.1em;
        font-weight:700;
      }
      .confirm-message { }
      .confirm-actions {
        display:flex;
        justify-content:center;
        gap:10px;
        margin-top:4px;
      }
      .confirm-actions > button {
        padding:6px 18px;
        border:6px solid #006600;
        border-radius:8px;
        background:#E9FFE9;
        cursor:pointer;
      }
      .confirm-actions > button:disabled {
        opacity:0.5;
        cursor:default;
      }
      /* 注意喚起バリアント（ボタン/見出しに強調色） */
      .confirmAlert .confirm-title {
        color:#300;
      }
      .confirmAlert .confirm-actions > .btn-yes {
        border-color:#FF0000;
        background:#FFE9E9;
      }
      /* === △ここまで△ 二択確認ダイアログ（共通） === */

      /* === ▽ここから▽ 主要ウインドウ 共通デザイン（ダイアログ/ポップアップを除く） === */
      .windowsCommon {
        display: inline-block;
        position: fixed;
        inset: 0px;
        margin: auto;
        box-shadow: 0 0 12px 0 rgba(51, 51, 51, 0.5);
        box-sizing: border-box;
        max-width: 97svw;
        max-height: 97svh;
        width: fit-content;
        height: fit-content;
        border: 8px solid #007A00;
        border-radius: 12px;
        padding: 16px;
        background-color: #F6FFFF;
        color: #000;
        overflow: auto;
        }
      /* === △ここまで△ 主要ウインドウ 共通デザイン（ダイアログ/ポップアップを除く） === */

      `;
    document.head.appendChild(style);
    // ------------------------------------------------------------
    // △ここまで△ スタイル（CSS）集中管理ブロック
    // ============================================================

    // 〓〓〓 空の <p> を削除 〓〓〓
    document.querySelectorAll('p').forEach(p => {
      if (!p.textContent.trim() && p.children.length === 0) {
        p.remove();
      }
    });

    // 〓〓〓 分解ボタンのラベル置換 〓〓〓
    document.querySelectorAll('form[action*="recycleunlocked"] button').forEach(btn => {
      if (btn.textContent.includes('ロックされていない武器防具を全て分解する')) {
        btn.textContent = 'ロックされていないアイテムを全て分解する';
      }
    });

    // 〓〓〓 宝箱リンクの置換 〓〓〓

    function replaceTreasureLinks(){
      const anchors = Array.from(document.querySelectorAll('h3>a'))
          .filter(a => a.getAttribute('href').endsWith('chest'));
      if (anchors.length === 0) return;
      const ul = document.createElement('ul');
      ul.id = 'treasurebox';
      ul.innerHTML = `
        <li><a href="${DBE_ORIGIN}/chest">宝箱</a></li>
        <li><a href="${DBE_ORIGIN}/battlechest">バトル宝箱</a></li>
      `;
      const firstH3 = anchors[0].parentNode;
      firstH3.parentNode.insertBefore(ul, firstH3);
      anchors.forEach(a => a.parentNode.remove());
    }

    // 〓〓〓 アイテム数サマリの挿入 〓〓〓

    function insertItemSummary(){
      // treasurebox がなければ necklaceTitle を代替に
      const ref = document.getElementById('treasurebox')
                || document.getElementById('necklaceTitle');
      if (!ref) return;

      function countRows(id) {
        const table = document.getElementById(id);
        return table?.tBodies[0]?.rows.length || 0;
      }

      const n   = countRows('necklaceTable'),
            w   = countRows('weaponTable'),
            a   = countRows('armorTable'),
            tot = n + w + a;

      const info = document.createElement('div');
      info.style.marginTop = '1em';
      info.innerHTML = `
        <div style="font-size:1.1em;font-weight:bold">所持アイテム総数：${tot}</div>
        <div style="font-size:1em">（ネックレス：${n}個／武器：${w}個／防具：${a}個）</div>
      `;
      ref.insertAdjacentElement('afterend', info);
    }

    // 〓〓〓 サーバー由来の h3/h4/h5 タグを div に置き換え 〓〓〓

    // ページ読み込み時に存在する h3/h4/h5 タグにマーカーを付与
    ['h3','h4','h5'].forEach(tag => {
      Array.from(document.getElementsByTagName(tag)).forEach(el => {
        el.setAttribute('data-donguri-original','true');
      });
    });
    // マーカー付き要素のみを div に置き換え
    const tagMap = {
      'H3': { size: '1.4em', bold: true,  margin: '6px' },
      'H4': { size: '1.2em', bold: false, margin: '4px' },
      'H5': { size: '1.1em', bold: false, margin: '4px' }
    };
    Object.entries(tagMap).forEach(([tag, { size, bold, margin }]) => {
      Array.from(document.getElementsByTagName(tag))
        .filter(el => el.getAttribute('data-donguri-original') === 'true')
        .forEach(el => {
          const d = document.createElement('div');
          d.innerHTML = el.innerHTML;
          d.style.fontSize   = size;
          d.style.margin     = margin;
          if (bold) d.style.fontWeight = 'bold';
          // 元の属性もコピー
          Array.from(el.attributes).forEach(a => d.setAttribute(a.name, a.value));
          el.replaceWith(d);
        });
    });

    // 〓〓〓 セル位置記憶＋自動スクロール 〓〓〓
    try {
      const lockReloadItemId = sessionStorage.getItem(lockReloadItemAnchorKey);
      if (lockReloadItemId) {
        try{ dbeScrollToItemRow(lockReloadItemId); }catch(_){}
        try{ sessionStorage.removeItem(lockReloadItemAnchorKey); }catch(_){}
        try{ clearAnchorCellMemory(); }catch(_){}
      } else {
        const id = sessionStorage.getItem(anchorKey);
        if (id) {
          lastClickedCellId = id;
          scrollToAnchorCell();
        }
      }
    } catch (_){ /* ignore */ }

    // --- 関数呼び出し ---
    initLockToggle();
    tableIds.forEach(processTable);
    initEquip();
    initRecycle();
    initMenu();          // 必要なセクションを各 dbe-W-* に直接生成
    initBulkRecycle();
    initDockMenu();      // 新ドックメニューを生成
    ensureHideAllControlInRecycle();    // ← Recycleに「全て分解ボタンを隠す」UIを挿入
    dbeInstallWindowFrontingObserver(); // 《dbe-W-*》の表示変化を監視し自動で最前面化
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAll);
  } else {
    initAll();
  }

  // 〓〓〓 「戻る」復帰（bfcache）等でUIを再同期 〓〓〓
  window.addEventListener('pageshow', (err)=>{
    if (err.persisted || (performance.getEntriesByType('navigation')[0]?.type === 'back_forward')) {
      syncMenuFromStorage();
      applyCellColors();
    }
  });
  document.addEventListener('visibilitychange', ()=>{
    if (document.visibilityState === 'visible') { syncMenuFromStorage(); applyCellColors(); }
  });

  // 〓〓〓 UI初期化 〓〓〓
  function initMenu(){

    // ============================================================
    // ▽ここから▽ テキストの横方向の中心線を合わせる
    // ──────────────────────────────
    // 指定ラベルだけ vertical-align:top を適用するマーク付け
    // ============================================================
    (function(){
      function __dbe_applyVATopInRules(root){
        const wnd = root || document.getElementById('dbe-W-Rules');
        if (!wnd) return;

        // ラベル内の「INPUT 以外の子ノード」をまとめて <span class="va-shift"> に包む
        // すでに包まれていれば何もしない
        const wrapLabelTextForVATop = (lb) => {
          if (!lb || lb.querySelector('.va-shift')) return;
          const wrap = document.createElement('span');
          wrap.className = 'va-shift';
          // 子ノードをスナップショットしてから移動（ライブ NodeList を壊さない）
          const nodes = Array.from(lb.childNodes);
          nodes.forEach(node => {
            // INPUT はそのまま（位置維持）。それ以外を va-shift の中へ
            if (node.nodeType === 1 && node.tagName === 'INPUT') return;
            wrap.appendChild(node);
          });
          // 何か移せたときだけ append（空ラッパは作らない）
          if (wrap.childNodes.length) lb.appendChild(wrap);
        };

        // ラベルの textContent でマッチして .va-top を付与
        const markLabels = (container, targets) => {
          if (!container) return;
          container.querySelectorAll('label').forEach(lb=>{
            const t = (lb.textContent || '').trim();
            if (targets.has(t)) {
              lb.classList.add('va-top');
              wrapLabelTextForVATop(lb); // ← テキスト側を 2px 上へ
            }
          });
        };

        // セクション見出しから右側セル（入力群）を推定
        const rightOf = (secNode) => {
          if (!secNode) return null;
          // .fc-row（display:contents）で2カラム構成：見出し(.fc-left)の次が入力(.fc-right)
          const row = secNode.closest('.fc-row');
          if (row) {
            const next = row.querySelector('.fc-right');
            if (next) return next;
          }
          // フォールバック：見出しの親を使う
          return secNode.parentElement || wnd;
        };

        // 1) 《動作モード》 …「ロック」「分解」
        const modeSec = Array.from(wnd.querySelectorAll('.fc-sec, .fc-left'))
          .find(s => (s.textContent || '').includes('動作モード'));
        markLabels(rightOf(modeSec), new Set(['ロック','分解']));

        // 2) 《Rarity》 …「UR」「SSR」「SR」「R」「N」「不問」
        const rarSec = Array.from(wnd.querySelectorAll('.fc-sec, .fc-left'))
          .find(s => (s.textContent || '').includes('Rarity'));
        markLabels(rightOf(rarSec), new Set(['UR','SSR','SR','R','N','不問']));

        // 3) 《Rarity》《武器名》《防具名》《SPD》《WT.》《Element》《マリモ》の「不問」
        ['Rarity','武器名','防具名','SPD','WT.','Element','マリモ'].forEach(h => {
          const sec = Array.from(wnd.querySelectorAll('.fc-sec, .fc-left'))
            .find(s => (s.textContent || '').trim().includes(h));
          markLabels(rightOf(sec), new Set(['不問']));
        });
      }

      // openRulesModal() 実行後に適用（存在すればラップ）
      const installWrapper = () => {
        if (typeof window.openRulesModal === 'function' && !window.openRulesModal.__dbeWrappedForVATop) {
          const orig = window.openRulesModal;
          window.openRulesModal = function(){
            const ret = orig.apply(this, arguments);
            // 描画直後に少し待ってから適用（DOM構築完了を待つ）
            setTimeout(()=>{ try{ __dbe_applyVATopInRules(); }catch(_e){} }, 0);
            return ret;
          };
          window.openRulesModal.__dbeWrappedForVATop = true;
          return true;
        }
        return false;
      };

      // すぐにラップを試み、ダメなら #dbe-W-Rules の表示切替を監視（フォールバック）
      if (!installWrapper()) {
        const wnd = document.getElementById('dbe-W-Rules');
        if (wnd && window.MutationObserver) {
          const obs = new MutationObserver(() => {
            const shown = getComputedStyle(wnd).display !== 'none';
            if (shown) { try{ __dbe_applyVATopInRules(wnd); }catch(err){} }
          });
          obs.observe(wnd, { attributes:true, attributeFilter:['style','class'] });
        }
      }
    })();
    // ============================================================
    // △ここまで△ テキストの横方向の中心線を合わせる
    // ============================================================

    // 二重初期化ガード（戻る復帰時や二重実行対策）
    if (document.getElementById('dbe-panel0-Settings')) return;
    // 旧バーガーUIと旧ウィンドウIDは使用しない
    const menu = document.createElement('div'); // 一時コンテナ（IDは付与しない）
    // ── panel-0 を 4 区分に分割 ─────────────────────────────
    const secSettings  = document.createElement('div');  secSettings.id  = 'dbe-panel0-Settings';
    const secRecycle   = document.createElement('div');  secRecycle.id   = 'dbe-panel0-Recycle';
    const secNav       = document.createElement('div');  secNav.id       = 'dbe-panel0-Navigation';
    const secAbout     = document.createElement('div');  secAbout.id     = 'dbe-panel0-About';
    // 適度な余白（必要なければ削除可）
    [secSettings,secRecycle,secNav,secAbout].forEach(s=>{ s.style.margin='8px 0'; });

    Object.assign(menu.style,{
      position:'fixed',bottom:'50px',left:'0',maxWidth:'450px',
      border:'3px solid #009300',borderRadius:'8px',
      padding:'8px 8px 4px 8px',backgroundColor:'#F6FFFF',display:'none',
      flexDirection:'column',alignItems:'flex-start',zIndex:'999991',
      maxHeight:'80vh',overflowY:'auto'
    });
    const spacer = ()=>{ const sp=document.createElement('div'); sp.style.height='0.5em'; return sp; };

    // --- 基準文字サイズ（ページ全体） ---
    const fsRow = document.createElement('div');
    fsRow.style.display='flex'; fsRow.style.gap='0'; fsRow.style.alignItems='center'; fsRow.style.margin='0 0 4px 0';
    const fsLabel = document.createElement('span'); fsLabel.textContent='基準文字サイズ：';
    const fsName  = 'dbe-fontsize';
    const fsOptions = ['16px','14px','12px'];
    const fsContainer = document.createElement('div'); fsContainer.style.display='flex'; fsContainer.style.gap='12px';
    const currentFS = readStr('baseFontSize');
    fsOptions.forEach(val=>{
      const lab = document.createElement('label'); lab.style.display='flex'; lab.style.alignItems='center'; lab.style.gap='0px';
      const r = document.createElement('input'); r.type='radio'; r.name=fsName; r.value=val; r.id=`dbe-prm-panel0-fontsize-${val}`;
      r.checked = (currentFS===val);
      r.addEventListener('change', ()=>{
        if (r.checked){ writeStr('baseFontSize', val); applyBaseFontSize(); }
      });
      lab.append(r, document.createTextNode(val));
      fsContainer.appendChild(lab);
    });
    fsRow.append(fsLabel, fsContainer);
    secSettings.appendChild(fsRow);

    // --- 装備テーブルのカスタマイズ ---
    const equipmentTableCustomTitle = document.createElement('div');
    equipmentTableCustomTitle.textContent = '装備テーブルのカスタマイズ';
    equipmentTableCustomTitle.style.cssText = 'margin:10px 0 4px 0;padding:0;font-size:1.05em;font-weight:bold';

    const equipmentTableCustomBox = document.createElement('div');
    equipmentTableCustomBox.id = 'dbe-prm-panel0-equipment-table-custom-box';
    equipmentTableCustomBox.style.cssText = [
      'display:flex',
      'flex-direction:column',
      'gap:4px',
      'margin:0 0 6px 0',
      'padding:8px 10px',
      'border:1px solid #666',
      'border-radius:8px',
      'background-color:#FAFFFF',
      'box-sizing:border-box',
      'width:fit-content',
      'max-width:100%'
    ].join(';');

    secSettings.appendChild(equipmentTableCustomTitle);
    secSettings.appendChild(equipmentTableCustomBox);

    // --- カラー設定：[錠]セル・[解錠]セル背景色 ---    // [錠]セルの背景色
    const unlockedInput = document.createElement('input');
    unlockedInput.type  = 'color';
    // カラーパレット呼び出しボックスの大きさ
    unlockedInput.style.border  = '2px solid #666666';
    unlockedInput.style.width  = '27px';
    unlockedInput.style.height = '27px';
    unlockedInput.style.margin = '2px 0 2px 0';
    unlockedInput.style.padding = '0';
    // 注: ボックス内の黒い隙間は上のCSSで除去
    unlockedInput.id    = 'dbe-prm-panel0-setcolor-cell-unlocked';
    unlockedInput.value = readStr('unlockedColor');
    const unlockedText  = document.createElement('input');
    unlockedText.type   = 'text';
    unlockedText.id     = 'dbe-prm-panel0-text-unlocked';
    // 表示は常に大文字に
    unlockedText.style.textTransform = 'uppercase';
    unlockedText.value  = unlockedInput.value;
    // ラベル
    const unlockedLabelSpan = document.createElement('span'); unlockedLabelSpan.textContent = '［錠］の背景色：';
    unlockedText.style.width  = '5em';
    unlockedText.style.margin = '0 4px 2px 0';
    unlockedText.style.padding = '2px 8px';
    // 入力即時反映
    // HEX 正規化（#RRGGBB へ統一、返せない場合は null）
    function normalizeHex(v){
      if(!v) return null;
      v = String(v).trim();
      if(/^#?[0-9a-fA-F]{6}$/.test(v)){
        if(v[0] !== '#') v = '#' + v;
        return v.toUpperCase();
      }
      return null;
    }

    // カラーパレット側の変更 → テキストへ反映（大文字化）
    unlockedInput.addEventListener('input', ()=>{
      const hex = normalizeHex(unlockedInput.value) || unlockedInput.value;
      unlockedText.value = hex.toUpperCase();
      writeStr('unlockedColor', unlockedText.value);
      applyCellColors();
    });
    // テキスト側の変更 → カラーパレットへ反映（確定時に正規化）
    unlockedText.addEventListener('change', ()=>{
      const hex = normalizeHex(unlockedText.value);
      if(hex){
        unlockedText.value  = hex;
        unlockedInput.value = hex;
        writeStr('unlockedColor', hex);
        applyCellColors();
      } else {
        // 入力が不正なら直前値へ戻す
        unlockedText.value = normalizeHex(unlockedInput.value) || unlockedInput.value.toUpperCase();
      }
    });

    // 1行にまとめて Settings へ
    const rowUnlocked = document.createElement('div');
    rowUnlocked.style.display='flex'; rowUnlocked.style.gap='8px'; rowUnlocked.style.margin='0 0 4px 0'; rowUnlocked.style.alignItems='center';
    rowUnlocked.append(unlockedLabelSpan, unlockedInput, unlockedText);
    equipmentTableCustomBox.appendChild(rowUnlocked);

    // [解錠]セルの背景色
    const lockedInput = document.createElement('input');
    lockedInput.type  = 'color';
    // カラーパレット呼び出しボックスの大きさ
    lockedInput.style.border  = '2px solid #666666';
    lockedInput.style.width  = '27px';
    lockedInput.style.height = '27px';
    lockedInput.style.margin = '2px 0 2px 0';
    lockedInput.style.padding = '0';
    // 注: ボックス内の黒い隙間は上のCSSで除去
    lockedInput.id    = 'dbe-prm-panel0-setcolor-cell-locked';
    lockedInput.value = readStr('lockedColor');
    const lockedText  = document.createElement('input');
    lockedText.type   = 'text';
    lockedText.id     = 'dbe-prm-panel0-text-locked';
    lockedText.value  = lockedInput.value;
    // 表示は常に大文字に
    lockedText.style.textTransform = 'uppercase';
    // ラベル
    const lockedLabelSpan = document.createElement('span'); lockedLabelSpan.textContent = '［解錠］の背景色：';
    lockedText.style.width  = '5em';
    lockedText.style.margin = '0 4px 2px 0';
    lockedText.style.padding = '2px 8px';

    // （参考）既存の applyCellColors／syncMenuFromStorage でも保存値はそのまま大文字で扱われます

    // カラーパレット側の変更 → テキストへ反映（大文字化）
    lockedInput.addEventListener('input', ()=>{
      const hex = normalizeHex(lockedInput.value) || lockedInput.value;
      lockedText.value = hex.toUpperCase();
      writeStr('lockedColor', lockedText.value);
      applyCellColors();
    });
    // テキスト側の変更 → カラーパレットへ反映（確定時に正規化）
    lockedText.addEventListener('change', ()=>{
      const hex = normalizeHex(lockedText.value);
      if(hex){
        lockedText.value  = hex;
        lockedInput.value = hex;
        writeStr('lockedColor', hex);
        applyCellColors();
      } else {
        // 入力が不正なら直前値へ戻す
        lockedText.value = normalizeHex(lockedInput.value) || lockedInput.value.toUpperCase();
      }
    });

    // 1行にまとめて Settings へ
    const rowLocked = document.createElement('div');
    rowLocked.style.display='flex'; rowLocked.style.gap='8px'; rowLocked.style.margin='0 0 4px 0'; rowLocked.style.alignItems='center';
    rowLocked.append(lockedLabelSpan, lockedInput, lockedText);
    equipmentTableCustomBox.appendChild(rowLocked);

    // --- ネックレス属性の簡易表示設定（未設定時はOFF＝false） ---
    const simpleNecAttrCk  = document.createElement('input'); simpleNecAttrCk.type = 'checkbox';
    simpleNecAttrCk.id     = 'dbe-prm-panel0-check-simple-nec-attr';
    simpleNecAttrCk.checked = readBool('showSimpleNecAttr');
    simpleNecAttrCk.addEventListener('change', ()=>{
      writeBool('showSimpleNecAttr', simpleNecAttrCk.checked);
      try{ dbeApplyAllNecklaceAttrDisplay(); }catch(err){ console.warn('[DBE] dbeApplyAllNecklaceAttrDisplay failed:', err); }
    });
    const rowSimpleNecAttr = document.createElement('label');
    rowSimpleNecAttr.style.display='flex'; rowSimpleNecAttr.style.gap='8px'; rowSimpleNecAttr.style.alignItems='center';
    rowSimpleNecAttr.append(simpleNecAttrCk, document.createTextNode('ネックレスの属性を簡易表示する'));
    equipmentTableCustomBox.appendChild(rowSimpleNecAttr);
    // 初期表示：前回の設定を反映
    try{ dbeApplyAllNecklaceAttrDisplay(); }catch(_){}

    // --- ネックレス「増減」列表示設定（未設定時はOFF＝false） ---
    const showDeltaCk  = document.createElement('input'); showDeltaCk.type = 'checkbox';
    showDeltaCk.id     = 'dbe-prm-panel0-check-display-necClm-Dlta';
    showDeltaCk.checked = readBool('showDelta');
    showDeltaCk.addEventListener('change', ()=>{
      const show = showDeltaCk.checked;
      toggleDeltaColumn(show);
      writeBool('showDelta', show);
      // 列構造を現在の設定に同期（重複生成/残骸を防ぐ）
      try{ refreshSortingForTableId('necklaceTable'); }catch(err){ console.warn('[DBE] refreshSortingForTableId(necklace) failed:', err); }
    });
    const rowDelta = document.createElement('label');
    rowDelta.style.display='flex'; rowDelta.style.gap='8px'; rowDelta.style.alignItems='center';
    rowDelta.append(showDeltaCk, document.createTextNode('ネックレスに「増減」列を表示する'));
    equipmentTableCustomBox.appendChild(rowDelta);
    // 初期表示：前回の設定を反映
    toggleDeltaColumn(showDeltaCk.checked);

    // --- ネックレス、武器、防具の装備種とクラスを隠す ---
    const cbNameSub = document.createElement('input'); cbNameSub.type='checkbox';
    cbNameSub.id = 'dbe-prm-panel0-check-hide-NameSub';
    cbNameSub.checked = readBool('hideKindClass');
    // 初期適用
    toggleNameSubLine(cbNameSub.checked);
    cbNameSub.addEventListener('change', ()=>{
      writeBool('hideKindClass', cbNameSub.checked);
      toggleNameSubLine(cbNameSub.checked);
    });
    const rowHideNameSub = document.createElement('label');
    rowHideNameSub.style.display='flex'; rowHideNameSub.style.gap='8px'; rowHideNameSub.style.alignItems='center';
    rowHideNameSub.append(cbNameSub, document.createTextNode('ネックレス、武器、防具の装備種とクラスを隠す'));
    equipmentTableCustomBox.appendChild(rowHideNameSub);

    // --- ネックレス、武器、防具の「錠／解錠」列を隠す（分解列の一つ上に配置） ---
    const cbLockCol = document.createElement('input'); cbLockCol.type='checkbox';
    cbLockCol.id = 'dbe-prm-panel0-check-hide-Clm-Lock';
    cbLockCol.checked = readBool('hideLockCol'); // デフォルト OFF
    // 初期適用
    toggleLockColumn(cbLockCol.checked);
    cbLockCol.addEventListener('change', ()=>{
      writeBool('hideLockCol', cbLockCol.checked);
      toggleLockColumn(cbLockCol.checked);
    });
    const rowHideLock = document.createElement('label');
    rowHideLock.style.display='flex'; rowHideLock.style.gap='8px'; rowHideLock.style.alignItems='center';
    rowHideLock.append(cbLockCol, document.createTextNode('ネックレス、武器、防具の「錠／解錠」列を隠す'));
    // 「分解列を隠す」の直前に挿入
    equipmentTableCustomBox.appendChild(rowHideLock);

    // 〓〓〓 ネックレス・武器・防具の「分解」列を隠す 〓〓〓
    const cbg = document.createElement('input'); cbg.type='checkbox';
    cbg.id = 'dbe-prm-panel0-check-hide-Clm-Rycl';
    cbg.checked = readBool('hideRyclCol');    // 初期適用: 分解列
    if (cbg.checked) tableIds.forEach(id=> document.querySelectorAll(`.${columnIds[id]['分解']}`).forEach(el=>el.style.display='none'));
    cbg.addEventListener('change', ()=>{
      writeBool('hideRyclCol', cbg.checked);
      tableIds.forEach(id=> document.querySelectorAll(`.${columnIds[id]['分解']}`).forEach(el=>el.style.display=cbg.checked?'none':''));
    });
    const rowHideCol = document.createElement('label');
    rowHideCol.style.display='flex'; rowHideCol.style.gap='8px'; rowHideCol.style.alignItems='center';
    rowHideCol.append(cbg, document.createTextNode('ネックレス、武器、防具の「分解」列を隠す'));
    equipmentTableCustomBox.appendChild(rowHideCol);

    // ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝
    // ★ 背景処理用：ロック/分解列の一時表示 ON/OFF スナップショット＆復元ヘルパ
    //   - 背景 iframe にもユーザースクリプトが入る環境で列が非表示だと、列検出やリンク探索が不安定になるため
    //   - startChestProcess() の頭で強制 ON、finishChest() で元の設定に戻す
    // ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝
    let __dbeColsBackup = null;
    function __dbeForceShowColsForRun(){
      // 現在値をスナップショット
      try{
        __dbeColsBackup = {
          hideLockCol: readBool('hideLockCol'),
          hideRyclCol: readBool('hideRyclCol'),
          showDelta  : readBool('showDelta'),
        };
      }catch(_){
        __dbeColsBackup = { hideLockCol:false, hideRyclCol:false, showDelta:false };
      }
      // 「錠／解錠」列：表示に一時強制（= 隠す設定をOFF）
      try{
        if (__dbeColsBackup.hideLockCol){
          writeBool('hideLockCol', false);
          if (typeof toggleLockColumn === 'function') toggleLockColumn(false);
        }
      }catch(err){ console.warn('[DBE] forceShowCols(lock) failed', err); }
      // 「分解」列：表示に一時強制（= 隠す設定をOFF）
      try{
        if (__dbeColsBackup.hideRyclCol){
          writeBool('hideRyclCol', false);
          tableIds.forEach(id=>{
            document.querySelectorAll(`.${columnIds[id]['分解']}`).forEach(el=> el.style.display='');
          });
        }
      }catch(err){ console.warn('[DBE] forceShowCols(recycle) failed', err); }
      // ネックレス「増減」列：表示に一時強制（= 有効化をON）
      try{
        if (!__dbeColsBackup.showDelta){
          writeBool('showDelta', true);
          if (typeof toggleDeltaColumn === 'function') toggleDeltaColumn(true);
          // 列未構築のケースも考慮して再ワイヤ
          if (typeof refreshSortingForTableId === 'function') refreshSortingForTableId('necklaceTable');
        }
      }catch(err){ console.warn('[DBE] forceShowCols(delta) failed', err); }
    }

    function __dbeRestoreColsAfterRun(){
      const b = __dbeColsBackup; __dbeColsBackup = null;
      if (!b) return;
      // 「錠／解錠」列：元に戻す
      try{
        writeBool('hideLockCol', b.hideLockCol);
        if (typeof toggleLockColumn === 'function') toggleLockColumn(b.hideLockCol);
      }catch(err){ console.warn('[DBE] restoreCols(lock) failed', err); }
      // 「分解」列：元に戻す
      try{
        writeBool('hideRyclCol', b.hideRyclCol);
        tableIds.forEach(id=>{
          document.querySelectorAll(`.${columnIds[id]['分解']}`).forEach(el=> el.style.display = b.hideRyclCol ? 'none' : '');
        });
      }catch(err){ console.warn('[DBE] restoreCols(recycle) failed', err); }
      // 「増減」列：元に戻す
      try{
        writeBool('showDelta', b.showDelta);
        if (typeof toggleDeltaColumn === 'function') toggleDeltaColumn(b.showDelta);
        if (typeof refreshSortingForTableId === 'function') refreshSortingForTableId('necklaceTable');
      }catch(err){ console.warn('[DBE] restoreCols(delta) failed', err); }
    }

    // 〓〓〓 対象行から「装」列のハイパーリンクを見つけてアイテムIDを抽出 〓〓〓
    function dbeExtractItemIdFromRow(kind, tr){
      try{
        if (!tr) return null;
        const equipCls =
          (kind === 'nec') ? 'necClm-Equp' :
          (kind === 'wep') ? 'wepClm-Equp' :
          (kind === 'amr') ? 'amrClm-Equp' : null;
        let cell = null;
        if (equipCls){
          cell = tr.querySelector(`td.${equipCls}`);
        }
        // 念のためフォールバック（多くのテーブルで2列目が「装」想定）
        if (!cell && tr.cells && tr.cells.length >= 2){
          cell = tr.cells[1];
        }
        if (!cell) return null;
        const a = cell.querySelector('a[href]'); // 最初のリンクを優先
        if (!a || !a.href) return null;
        // 典型的なパターンを網羅
        const href = a.href;
        // .../equip/12345, .../item/12345, ?id=12345, ?item=12345 など
        const m =
          href.match(/(?:equip|item|id)[=/](\d+)/i) ||
          href.match(/[?&](?:id|item)=(\d+)/i);
        return m ? m[1] : null;
      }catch(_){
        return null;
      }
    }

    // 〓〓〓 名称列と装備列の間にアイテムIDを表示 〓〓〓
    const cbItemId = document.createElement('input'); cbItemId.type='checkbox';
    cbItemId.id = 'dbe-prm-panel0-check-display-ItemID';
    // 既定OFF。readBool が無い環境でも落ちないように try/catch
    try { cbItemId.checked = typeof readBool === 'function' ? readBool('displayItemId') : false; } catch { cbItemId.checked = false; }

    // 初期適用（テーブル未構築でも安全に無視される）
    if (cbItemId.checked) toggleItemIdColumn(true);

    cbItemId.addEventListener('change', ()=>{
      const on = cbItemId.checked;
      try { if (typeof writeBool === 'function') writeBool('displayItemId', on); } catch {}
      toggleItemIdColumn(on);
    });

    const rowItemId = document.createElement('label');
    rowItemId.style.display='flex'; rowItemId.style.gap='8px'; rowItemId.style.alignItems='center';
    rowItemId.append(cbItemId, document.createTextNode('名称列と装備列の間にアイテムIDを表示する'));
    equipmentTableCustomBox.appendChild(rowItemId);

    // --- DBEランチャーボタン（携帯端末用）の配置設定 ---
    const mobileLauncherTitle = document.createElement('div');
    mobileLauncherTitle.textContent = 'DBEランチャーボタン（携帯端末用）';
    mobileLauncherTitle.style.cssText = 'margin:10px 0 4px 0;padding:0;font-size:1.05em;font-weight:bold';

    const mobileLauncherGrid = document.createElement('div');
    mobileLauncherGrid.id = 'dbe-prm-panel0-mobile-launcher-pos-grid';
    mobileLauncherGrid.style.cssText = [
      'display:grid',
      'grid-template-columns:1fr 1fr',
      'gap:6px 12px',
      'margin:0 0 6px 0',
      'padding:8px 10px',
      'border:1px solid #666',
      'border-radius:8px',
      'background-color:#FAFFFF',
      'box-sizing:border-box',
      'width:fit-content',
      'max-width:100%'
    ].join(';');

    const mobileLauncherName = 'dbe-mobile-launcher-pos';
    const mobileLauncherCurrent = readStr('mobileLauncherPos');
    const mobileLauncherDefs = [
      { value:'left-top',     label:'左上' },
      { value:'right-top',    label:'右上' },
      { value:'left-bottom',  label:'左下' },
      { value:'right-bottom', label:'右下' },
    ];
    mobileLauncherDefs.forEach(def=>{
      const lab = document.createElement('label');
      lab.style.cssText = 'display:flex;align-items:center;gap:4px;white-space:nowrap;user-select:none;';

      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = mobileLauncherName;
      radio.value = def.value;
      radio.id = `dbe-prm-panel0-radio-mobile-launcher-pos-${def.value}`;
      radio.checked = (mobileLauncherCurrent === def.value);
      radio.addEventListener('change', ()=>{
        if (!radio.checked) return;
        writeStr('mobileLauncherPos', def.value);
        dbeApplyMobileLauncherPosition(null, def.value);
      });

      lab.append(radio, document.createTextNode(def.label));
      mobileLauncherGrid.appendChild(lab);
    });

    secSettings.append(mobileLauncherTitle, mobileLauncherGrid);

    // --- 分解アラート設定UI（Recycle セクションへ） ---
    const secRecycl_Button    = document.createElement('div');
    secRecycl_Button.style.cssText = 'margin:0px;padding:8px;border:1px solid #666;border-radius:8px';
    secRecycl_Button.id = 'dbe-recycle-bulk-alert';  // ← アンカーとして識別できるよう ID を付与
    // タイトル「全て分解」まきこみアラート
    const secRecycl_title  = document.createElement('div');
    secRecycl_title.textContent = '「全て分解」まきこみアラート';
    secRecycl_title.style.cssText = 'margin:4px 0;padding:0;font-size:1.1em;font-weight:bold';
    // グレードチェックボックス
    const secRecycl_alert_grade   = document.createElement('div');
    secRecycl_alert_grade.style.cssText = 'display:flex;flex-wrap:wrap;gap:12px;margin:0 12px 0 16px';
    { const defs = {'プラチナ':'Pt','金':'Au','銀':'Ag','青銅':'CuSn','銅':'Cu'};
      for(const [label,val] of Object.entries(defs)){
        const ck = document.createElement('input'); ck.type  = 'checkbox'; ck.value = val; ck.id    = `alert-grade-${val}`;
        ck.checked = dbeStorage.getItem(ck.id) === 'true';
        const lb = document.createElement('label'); lb.append(ck, document.createTextNode(' '+label));
        secRecycl_alert_grade.appendChild(lb);
        ck.addEventListener('change', ()=>{ dbeStorage.setItem(ck.id, ck.checked); });
      }
    }
    // レアリティチェックボックス
    const secRecycl_alert_rarity = document.createElement('div');
    secRecycl_alert_rarity.style.cssText = 'display:flex;flex-wrap:wrap;gap:12px;margin:0 12px 0 16px';
    for(const rk of ['UR','SSR','SR','R','N']){
      const ck = document.createElement('input'); ck.type  = 'checkbox'; ck.value = rk; ck.id    = `alert-rarity-${rk}`;
      ck.checked = dbeStorage.getItem(ck.id) === 'true';
      const lb = document.createElement('label'); lb.append(ck, document.createTextNode(' '+rk)); secRecycl_alert_rarity.appendChild(lb);
      ck.addEventListener('change', ()=>{ dbeStorage.setItem(ck.id, ck.checked); });
    }
    secRecycl_Button.appendChild(secRecycl_alert_grade);
    secRecycl_Button.appendChild(secRecycl_alert_rarity);
    secRecycl_Button.appendChild(secRecycl_title);
    secRecycle.appendChild(secRecycl_Button);

    // --- 「全て分解する」ボタン（アラート枠の内側へ） ---
    const allForm=document.createElement('form');
    allForm.action=`${DBE_ORIGIN}/recycleunlocked`; allForm.method='POST';
    const allBtn=document.createElement('button');
    allBtn.type='submit';
    allBtn.textContent='ロックされていないアイテムを全て分解する';
    allBtn.style.cssText='fontSize:0.9em; padding:4px 8px; margin:12px 0 4px 0;';
    allForm.appendChild(allBtn);
    secRecycl_Button.appendChild(allForm);

    // 〓〓〓 ナビ（ウィンドウ用：タイトル独立＋縦並び＋幅7em） 〓〓〓
    // タイトル（flex から分離）
    const navTitle = document.createElement('div');
    navTitle.textContent = 'ナビゲーション';
    navTitle.style.cssText = 'margin:4px auto 4px 8px;padding:0;white-space:nowrap;font-size:1.1em;font-weight:bold;';
    secNav.appendChild(navTitle);

   // ボタン群（縦並び）
    const navList = document.createElement('div');
    navList.style.cssText = 'display:flex;flex-direction:column;gap:6px;align-items:flex-start;';
    secNav.appendChild(navList);

    const mkBtn = (label, onClick) => {
      const b = document.createElement('button');
      b.textContent = label;
      Object.assign(b.style, {
        width: '12em',
        margin: '8px auto',
        padding: '4px auto',
        textAlign: 'center',
        fontSize: '0.95em'
      });
      b.addEventListener('click', onClick);
      return b;
    };

    const scrollTableBottomRowToCenter = (tableId)=>{
      const table = document.getElementById(tableId);
      if (!table) return;

      const tbody = table.tBodies && table.tBodies[0];
      const rows = tbody ? Array.from(tbody.rows) : [];

      // フィルタ等で非表示行がある場合は「現在表示されている最下行」を優先する。
      // 表示行が取れない場合は、テーブル自体を下端寄りに表示する。
      const targetRow = rows.slice().reverse().find(tr=>{
        try{
          const cs = getComputedStyle(tr);
          return cs.display !== 'none'
              && cs.visibility !== 'hidden'
              && tr.getClientRects().length > 0;
        }catch(_){
          return false;
        }
      }) || rows[rows.length - 1] || null;

      const target = targetRow || table;
      try{
        const rect = target.getBoundingClientRect();
        const top = window.scrollY + rect.top + (rect.height / 2) - (window.innerHeight / 2);
        window.scrollTo({
          top: Math.max(0, top),
          behavior: 'smooth'
        });
      }catch(_){
        try{
          target.scrollIntoView({behavior:'smooth', block:'center'});
        }catch(__){}
      }
    };

    // PageTOP
    navList.appendChild(
      mkBtn('PageTOP', ()=>window.scrollTo({top:0, behavior:'smooth'}))
    );
    // セクションボタン
    for (const o of [
      { text:'ネックレス',     id:'necklaceTitle', mode:'title'  },
      { text:'ネックレス下端', id:'necklaceTable', mode:'bottom' },
      { text:'武器',           id:'weaponTitle',   mode:'title'  },
      { text:'武器下端',       id:'weaponTable',   mode:'bottom' },
      { text:'防具',           id:'armorTitle',    mode:'title'  },
      { text:'防具下端',       id:'armorTable',    mode:'bottom' },
    ]) {
      navList.appendChild(
        mkBtn(o.text, ()=>{
          if (o.mode === 'bottom') {
            scrollTableBottomRowToCenter(o.id);
            return;
          }
          const el = document.getElementById(o.id);
          if (el) el.scrollIntoView({behavior:'smooth', block:'start'});
        })
      );
    }
    // panel へ配置
    menu.appendChild(secNav);

    const link = document.createElement('div'); link.style.fontSize='0.8em';
      link.innerHTML = [ `Donguri Bag Enhancer ver ${DBE_VERSION}` ];
    secAbout.appendChild(link);

    // （旧ハンバーガーUIは廃止のため、menu を DOM に追加しない）
    // セクションを各 dbe-W-* に直載せ（secNav は Navi、Recycle/Settings は各ウィンドウ）
    ensureWindowShell('dbe-W-Settings').append(secSettings, secAbout);
    ensureWindowShell('dbe-W-Recycle').append(secRecycle);
    ensureWindowShell('dbe-W-Navi').append(secNav);
    // 初期描画直後に同期
    syncMenuFromStorage();
  } // ← initMenu の閉じ

  // 〓〓〓 Z-Index 前面制御（共通ユーティリティ） 〓〓〓
  //   - 新規に前面化が必要なときは dbeBringToFront(wnd) を呼ぶ
  //   - __DBE_Z_NEXT はグローバルな採番カウンタ
  function dbeIsWindowVisible(el){
    try{
      if (!el) return false;
      const cs = getComputedStyle(el);
      return !!cs && cs.display !== 'none' && cs.visibility !== 'hidden';
    }catch(_){
      return false;
    }
  }
  // dbe-W-Chest と dbe-W-ChestProgress が同時表示中は、常に Progress を前面に保つ
  function dbeEnsureChestProgressOnTop(){
    try{
      const chest = document.getElementById('dbe-W-Chest');
      const prog  = document.getElementById('dbe-W-ChestProgress');
      if (!chest || !prog) return;
      if (!dbeIsWindowVisible(chest) || !dbeIsWindowVisible(prog)) return;

      const zChest = parseInt(getComputedStyle(chest).zIndex||'0',10);
      const zProg  = parseInt(getComputedStyle(prog ).zIndex||'0',10);
      if (!isNaN(zChest) && !isNaN(zProg) && zProg > zChest) return;

      const z = ((window.__DBE_Z_NEXT = (window.__DBE_Z_NEXT||1000001) + 10));
      window.__DBE_Z_WINDOW_MAX = Math.max(window.__DBE_Z_WINDOW_MAX||1000000, z);
      prog.style.zIndex = String(z);
      prog.dataset.dbeFronted = '1';
      chestDiag('ensureChestProgressOnTop: fronted dbe-W-ChestProgress', '→ zIndex=', z);
    }catch(_){}
  }
  function dbeBringToFront(wnd){
    try{
      if (/^dbe-W-/.test(wnd.id||'')){
        const z = ((window.__DBE_Z_NEXT = (window.__DBE_Z_NEXT||1000001) + 10));
        window.__DBE_Z_WINDOW_MAX = Math.max(window.__DBE_Z_WINDOW_MAX||1000000, z);
        wnd.style.zIndex = String(z);
        wnd.dataset.dbeFronted = '1';
        chestDiag('bringToFront: window', wnd.id, '→ zIndex=', z);
      } else {
        // ダイアログは専用帯域で前面化
        dbeBringDialogToFront(wnd);
      }
    }catch(_){}
    // 例外ルール：宝箱ウィンドウより進行ウィンドウを常に前面へ
    try{ dbeEnsureChestProgressOnTop(); }catch(_){}
  }

  // 〓〓〓 《dbe-W-*》の表示切替を監視して自動前面化 〓〓〓
  //   - openRulesModal 等、外部実装で開くウインドウも対象にするためのフォールバック
  function dbeInstallWindowFrontingObserver(){
    try{
      if (!window.MutationObserver) return;
      // 属性変化（style/class）監視：display が「none → 可視」になった最初の1回だけ前面化
      const watchAttrs = (el)=>{
        try{
          if (!el || !el.id || !/^dbe-W-/.test(el.id)) return;
          const mo = new MutationObserver((_muts)=>{
            try{
              const disp = getComputedStyle(el).display;
              if (disp && disp !== 'none') {
                // 可視化された直後の1回だけ前面化（ループ抑止のためフラグで制御）
                if (el.dataset.dbeFronted !== '1') {
                  el.dataset.dbeFronted = '1';
                  dbeBringToFront(el);
                  chestDiag('frontingObserver: shown -> fronted', el.id);
                }
              } else {
                // 非表示になったらフラグ解除（次回の可視化で再び1回だけ前面化）
                if (el.dataset.dbeFronted === '1') delete el.dataset.dbeFronted;
                chestDiag('frontingObserver: hidden', el.id);
              }
            }catch(_){}
          });
          mo.observe(el, { attributes:true, attributeFilter:['style','class'] });
        }catch(_){}
      };
      // 既存の dbe-W-* を監視に載せる
      document.querySelectorAll('[id^="dbe-W-"]').forEach(watchAttrs);
      // 追加された要素も拾う
      const moAdd = new MutationObserver((muts)=>{
        muts.forEach(mu=>{
          (mu.addedNodes||[]).forEach(n=>{
            if (n && n.nodeType===1 && n.id && /^dbe-W-/.test(n.id)){
              watchAttrs(n);
              // 追加直後に可視なら直ちに前面化
              try{
                const disp = getComputedStyle(n).display;
                if (disp && disp !== 'none') {
                  if (n.dataset.dbeFronted !== '1') {
                    n.dataset.dbeFronted = '1';
                    dbeBringToFront(n);
                  }
                  chestDiag('frontingObserver(add): appended & visible', n.id);
                } else {
                  if (n.dataset.dbeFronted === '1') delete n.dataset.dbeFronted;
                  chestDiag('frontingObserver(add): appended but hidden', n.id);
                }
              }catch(_){}
            }
          });
        });
      });
      // 直接 body 配下に追加される dbe-W-* だけを監視（過剰な全サブツリー監視を抑止）
      moAdd.observe(document.body, { childList:true, subtree:false });
    }catch(_){}
  }

  // ============================================================
  // ▽追加▽ 宝箱：進行ウインドウ＆ログ
  // ============================================================
  (function(){
    // Rarity/Grade カラー（文字色に適用）
    const RAR_COLOR = { UR:'#F45D01', SSR:'#A633D6', SR:'#1E88E5', R:'#2E7D32', N:'#9E9E9E' };
    const GRD_COLOR = { Pt:'#F45D01', Au:'#A633D6', Ag:'#1E88E5', CuSn:'#2E7D32', Cu:'#9E9E9E' };
    const TYPE_LABEL = {
      normal:'武器と防具：標準サイズ',
      large :'武器と防具：大型サイズ',
      battle:'ネックレス：バトル標準サイズ',       // 互換（旧battle）
      battle_normal:'ネックレス：バトル標準サイズ',
      battle_large :'ネックレス：バトル大型サイズ'
    };

    function dbeChestIsBattleKind(kind){
      const s = String(kind || '');
      return (s === 'battle' || s === 'battle_normal' || s === 'battle_large');
    }

    function dbeChestLootTableIdsForKind(kind){
      return dbeChestIsBattleKind(kind)
        ? ['necklaceTable']
        : ['weaponTable', 'armorTable'];
    }

    const DBE_CHEST_LOG_KEYS = {
      grade: {
        Pt:   { id:'dbe-prm-ChestLog--grade-Pt',   def:true  },
        Au:   { id:'dbe-prm-ChestLog--grade-Au',   def:true  },
        Ag:   { id:'dbe-prm-ChestLog--grade-Ag',   def:true  },
        CuSn: { id:'dbe-prm-ChestLog--grade-CuSn', def:false },
        Cu:   { id:'dbe-prm-ChestLog--grade-Cu',   def:false }
      },
      rarity: {
        UR:  { id:'dbe-prm-ChestLog--rarity-UR',  def:true  },
        SSR: { id:'dbe-prm-ChestLog--rarity-SSR', def:true  },
        SR:  { id:'dbe-prm-ChestLog--rarity-SR',  def:false },
        R:   { id:'dbe-prm-ChestLog--rarity-R',   def:false },
        N:   { id:'dbe-prm-ChestLog--rarity-N',   def:false }
      }
    };

    const DBE_CHEST_NO_MATCH_LOG_TEXT = '表示条件に一致する装備はありませんでした';

    function dbeReadChestLogBool(ent){
      try{
        const v = dbeStorage.getItem(ent.id);
        return v === null ? !!ent.def : v === 'true';
      }catch(_){
        return !!ent.def;
      }
    }

    function dbeEnsureChestProgressUI(){
      const wnd = ensureWindowShell('dbe-W-ChestProgress');
      // 見た目：主要ウインドウスキン
      wnd.classList.add('windowsCommon');
      // 進行ウインドウ：
      // - 初期高さは「960px」または「表示可能領域の95%」の小さい方
      // - ユーザーが枠をドラッグして高さを一時変更できるようにする
      // - 高さ変更は保存しない
      Object.assign(wnd.style, {
        height: 'min(960px, 95svh)',
        maxHeight: '95svh',
        minHeight: '320px',
        resize: 'vertical',
        overflow: 'auto',
        boxSizing: 'border-box'
      });
      // 右上の「×」は使わない（閉じるは下部ボタンのみ）
      (function(){
        const closeBtn = wnd.firstElementChild;
        if (closeBtn && closeBtn.tagName === 'BUTTON'){
          closeBtn.style.display = 'none';
          closeBtn.disabled = true;
        }
      })();
      // 本体再構築（×ボタン以外クリア）
      Array.from(wnd.children).forEach((ch,i)=>{ if(i>0) ch.remove(); });
      const wrap = document.createElement('div');
      Object.assign(wrap.style,{
        display:'grid',
        gridTemplateRows:'auto auto auto minmax(0, 1fr) auto',
        gap:'0.8em',
        minWidth:'min(70svw,480px)',
        height:'100%',
        boxSizing:'border-box'
      });

      // タイトル
      const ttl = document.createElement('div');
      ttl.textContent = '宝箱の自動処理（進行状況）';
      ttl.style.cssText = 'font-size:1.15em;font-weight:700;';
      wrap.appendChild(ttl);

      // 対象＆回数
      const box = document.createElement('div');
      Object.assign(box.style,{display:'grid',gridTemplateColumns:'max-content 1fr',columnGap:'12px',rowGap:'6px',alignItems:'center'});
      const r1l = document.createElement('div'); r1l.textContent = '対象：'; r1l.style.fontWeight='700';
      const r1v = document.createElement('div'); r1v.id='dbe-chestprog-type';
      const r2l = document.createElement('div'); r2l.textContent = '回数：'; r2l.style.fontWeight='700';
      const r2v = document.createElement('div'); r2v.id='dbe-chestprog-count';
      box.append(r1l,r1v,r2l,r2v);
      wrap.appendChild(box);

      // 宝箱／バトル宝箱の簡易ログ（固定高・スクロール）
      const logTitle = document.createElement('div');
      logTitle.textContent = '宝箱／バトル宝箱の簡易ログ：';
      logTitle.style.cssText='font-weight:700;margin-top:4px;';
      const log = document.createElement('div');
      log.id = 'dbe-chestprog-log';
      Object.assign(log.style,{
        border:'1px solid #999', borderRadius:'8px',
        padding:'0.4em 0.8em', background:'#fff',
        minHeight:'8em',
        height:'auto',
        overflow:'auto',
        lineHeight:'1.1em'
      });
      wrap.append(logTitle, log);

      // 操作
      const ops = document.createElement('div');
      Object.assign(ops.style,{display:'flex',justifyContent:'center',gap:'18px',marginTop:'6px'});
      const btnAbort = document.createElement('button');
      btnAbort.id='dbe-chestprog-abort';
      btnAbort.textContent='中断する';
      Object.assign(btnAbort.style,{padding:'6px 14px',border:'2px solid #930000',borderRadius:'8px',background:'#FFE9E9',cursor:'pointer'});
      const btnClose = document.createElement('button');
      btnClose.id='dbe-chestprog-close';
      btnClose.textContent='閉じる';
      Object.assign(btnClose.style,{padding:'6px 14px',border:'2px solid #006600',borderRadius:'8px',background:'#E9FFE9',cursor:'default',opacity:'0.5'});
      btnClose.disabled = true; // 処理中は無効
      ops.append(btnAbort, btnClose);
      wrap.appendChild(ops);

      wnd.appendChild(wrap);
      chestDiag('progressUI: built content for', wnd.id);

      // ▼自動クローズ抑止：ユーザーが「閉じる」を押すまで開いたままにするガード
      //   - display が外部要因で none にされたら、ユーザー操作以外は即座に復元する
      try{
        const DBE_CHEST = (window.DBE_CHEST = window.DBE_CHEST || {});
        if (window.MutationObserver){
          if (wnd.__dbe_keep_open_observer) { try{ wnd.__dbe_keep_open_observer.disconnect(); }catch(_){ } }
          const ob = new MutationObserver(()=>{
            try{
              const disp = getComputedStyle(wnd).display;
              // ユーザー操作以外で隠された（display:none）場合は復元
              if (disp === 'none' && !DBE_CHEST._userClosing){
                wnd.style.display = 'inline-block';
                dbeBringToFront(wnd);
                chestDiag('keep-open: prevented unexpected close, restored window');
              }
            }catch(_){}
          });
          ob.observe(wnd, { attributes:true, attributeFilter:['style','class'] });
          wnd.__dbe_keep_open_observer = ob;
          // 追加：ノードごと削除された場合の復活（document.body を監視）
          if (wnd.__dbe_keep_open_bodyObserver) { try{ wnd.__dbe_keep_open_bodyObserver.disconnect(); }catch(_){ } }
          const bodyOb = new MutationObserver(()=>{
            try{
              const alive = document.getElementById('dbe-W-ChestProgress');
              if (!alive && !DBE_CHEST._userClosing){
                chestDiag('keep-open: node removed -> re-create');
                const nw = dbeEnsureChestProgressUI();
                nw.style.display = 'inline-block';
                dbeBringToFront(nw);
              }
            }catch(_){}
          });
          bodyOb.observe(document.body, { childList:true, subtree:true });
          wnd.__dbe_keep_open_bodyObserver = bodyOb;
        }
      }catch(_){}

      // ハンドラ
      btnAbort.onclick = ()=>{
        const DBE_CHEST = (window.DBE_CHEST = window.DBE_CHEST || {});
        DBE_CHEST._userAbort = true; // 次の宝箱実行を抑止
        btnAbort.textContent = '中断します…';
        btnAbort.disabled = true;
        btnAbort.style.opacity = '0.6';
      };
      btnClose.onclick = async ()=>{
        const DBE_CHEST = (window.DBE_CHEST = window.DBE_CHEST || {});
        const prevCloseText = btnClose.textContent;
        btnClose.disabled = true;
        btnClose.style.opacity = '0.6';
        btnClose.style.cursor = 'default';
        btnClose.textContent = '更新中…';

        // keep-open 監視に「ユーザー操作による閉鎖」であることを先に知らせる。
        // これを立てずに display:none にすると、MutationObserver が即座に復元してしまう。
        DBE_CHEST._userClosing = true;

        // ▼ ハードリロードは実行せず、/bag の本体テーブルだけを取得して差し替える
        //   #dbe-W-Chest やその他の dbe-W-* モーダルは DOM 上に残す。
        try{
          if (window.__DBE_RELOAD_GUARD && typeof window.__DBE_RELOAD_GUARD.disable==='function'){
            window.__DBE_RELOAD_GUARD.disable({ executePending:false });
          }
        }catch(_){}
        try{
          await dbeRefreshBagPageMainFromServer();
        }catch(err){
          console.warn('[DBE] refresh /bag on ChestProgress close failed:', err);
        }

        // 安全に閉じる（閉じる対象は #dbe-W-ChestProgress のみ）
        try{
          const log = document.getElementById('dbe-chestprog-log');
          if (log) log.textContent = '';
        }catch(_){}
        wnd.style.display = 'none';
        if (wnd.dataset.dbeFronted === '1') delete wnd.dataset.dbeFronted;
        try{ dbeHideOverlay(); }catch(_){}
        chestDiag('progressUI: close clicked');

        // ▼ 念のため：停止後に内部状態が残っても次回実行を阻害しないよう、ここでも解放しておく
        //   （ng<>too fast 等で handleServerErrorAndStopFlow が動いたケースの保険）
        try{
          // 進行タイマー停止
          clearInterval(DBE_CHEST._progressTimer); DBE_CHEST._progressTimer = null;
          // HUD停止
          try{ if (typeof stopProgressHud === 'function') stopProgressHud(); }catch(_){}
          // 列表示状態を復元（強制ONの解除）
          try{ __dbeRestoreColsAfterRun(); }catch(_){}
          // ループ/実行中フラグの解放
          DBE_CHEST.left         = 0;
          DBE_CHEST.unlimited    = false;
          DBE_CHEST._autoRunning = false;
          DBE_CHEST.didWork      = false;
          DBE_CHEST.stage        = 'idle';
          DBE_CHEST.busy         = false;
          // 次回実行で lootObserver が再アタッチできるように
          DBE_CHEST._lootObserved = false;
          // エラー状態もクリア（次回 start で再初期化されるが、残留防止）
          DBE_CHEST._serverError = false;
          // 新規取得装備の簡易ログ用状態も初期化
          DBE_CHEST._lootBeforeOpen = null;
          DBE_CHEST._backgroundBagSnapshotDoc = null;
          DBE_CHEST._pendingBgAction = null;
          DBE_CHEST._pendingBgActionId = null;
          DBE_CHEST._directActionBusy = false;
          // 差分取得ログ／onlyNew監視ログの共通重複ガード
          DBE_CHEST._onlyNewLogged  = new Set();
          DBE_CHEST._onholdLogged   = new Set();
        }catch(_){}
        // 次回 dbeEnsureChestProgressUI() でボタン状態は再構築されるが、念のため見た目を戻す
        try{
          btnClose.textContent = prevCloseText || '閉じる';
          btnClose.style.opacity = '1';
          btnClose.style.cursor = 'pointer';
        }catch(_){}
        // ユーザー閉鎖フラグは少し後で解除（再オープン時の誤判定を避ける）
        setTimeout(()=>{ try{ (window.DBE_CHEST = window.DBE_CHEST || {})._userClosing = false; }catch(_){} }, 0);
      };
      return wnd;
    }

    function dbeSetProgressHeader(type){
      const t = document.getElementById('dbe-chestprog-type');
      if (t) t.textContent = TYPE_LABEL[type] || String(type||'');
    }
    function dbeUpdateCount(){
      const DBE_CHEST = (window.DBE_CHEST = window.DBE_CHEST || {});
      const el = document.getElementById('dbe-chestprog-count');
      if (!el) return;
      const done = Number(DBE_CHEST.processed||0);
      if (DBE_CHEST.unlimited){
        el.textContent = `${done} 回 / 無制限`;
      } else {
        const tot = DBE_CHEST._totalPlanned ?? 0;
        el.textContent = `${done} 回 / ${tot} 回`;
      }
    }
    // dbeSubmitChestOpenElement() はこの IIFE の外側にあるため、
    // 進行モーダルの回数表示更新だけを安全に呼べるよう公開しておく。
    window.DBE_UpdateChestCount = dbeUpdateCount;

    // ──────────────────────────────────────────────
    // 分子カウント：実際に「宝箱を開ける」送信を行ったタイミングで加算する
    //  - 標準/大型/バトル標準/バトル大型のいずれも「ボタン実行回数」を +1 で数える
    //  - URL監視の自動カウント(dbeChestMaybeCount)は _countFromUrl=true のときのみ有効
    // ──────────────────────────────────────────────
    function dbeChestOpenStep(){
      try{
        return 1;
      }catch(_){ return 1; }
    }
    function dbeChestBumpProcessed(step, src, url){
      try{
        const DBE_CHEST = (window.DBE_CHEST = window.DBE_CHEST || {});
        const n = Number(step||0);
        if (!n) return;
        DBE_CHEST.processed = (Number(DBE_CHEST.processed||0) + n);
        dbeUpdateCount();
        chestDiag('ChestCount('+(src||'open')+'): +'+n, url || '');
      }catch(_){}
    }

    // ──────────────────────────────────────────────
    // 追加：自動実行中のみ /chest /battlechest への実アクセスをカウントする共通関数
    //   - ネイティブ操作（自動実行外）ではカウントしない
    //   - 短時間デデュープ（同一URL連発の二重カウント抑止）
    //   - ProgressUI の表示を即時更新
    // ──────────────────────────────────────────────
    function dbeChestMaybeCount(url){
      try{
        const DBE_CHEST = (window.DBE_CHEST = window.DBE_CHEST || {});
        // 自動実行プロセス中のみカウント
        if (!DBE_CHEST._autoRunning) return;
        // URL監視カウントは明示的に有効化された場合のみ
        if (!DBE_CHEST._countFromUrl) return;
        const u = String(url);
        if (!/\/(battlechest|chest)(?:[/?#]|$)/.test(u)) return;
        // デデュープ
        const recent = (DBE_CHEST._countDedup = DBE_CHEST._countDedup || new Set());
        const key = u + '@' + (Math.floor(Date.now()/250)); // 250msスロットで抑制
        if (recent.has(key)) return;
        recent.add(key);
        setTimeout(()=>{ try{ recent.delete(key); }catch(_){ } }, 3000);
        // 加算＆反映
        dbeChestBumpProcessed(1, 'auto', u);
      }catch(_){}
    }

    // ──────────────────────────────────────────────
    // 分子カウントフック：/chest /battlechest 送出時に +1
    //  - fetch / <a>.click() / <form>.submit() を監視
    //  - 連続送出の二重カウントを軽減（短時間デデュープ）
    // ──────────────────────────────────────────────
    function dbeInstallChestCountHooks(){
      const DBE_CHEST = (window.DBE_CHEST = window.DBE_CHEST || {});
      if (DBE_CHEST._countHooksInstalled) return;
      DBE_CHEST._countHooksInstalled = true;
      const isChestUrl = (u)=>{
        try{
          if (!u) return false;
          const url = String(u);
          return /\/(battlechest|chest)(?:[/?#]|$)/.test(url);
        }catch(_){ return false; }
      };
      // fetch フック
      try{
        if (!DBE_CHEST._origFetch && typeof window.fetch === 'function'){
          DBE_CHEST._origFetch = window.fetch.bind(window);
          window.fetch = function(resource, init){
            try{
              const url = (typeof resource === 'string') ? resource : (resource && resource.url);
              if (isChestUrl(url)) dbeChestMaybeCount(url);
            }catch(_){}
            return DBE_CHEST._origFetch.apply(this, arguments);
          };
        }
      }catch(_){}
      // <a>.click() フック
      try{
        const AProto = window.HTMLAnchorElement && window.HTMLAnchorElement.prototype;
        if (AProto && !AProto.__dbeChestClickWrapped){
          const _orig = AProto.click;
          AProto.click = function(){
          const href = (this && this.href) ? String(this.href) : '';
            try{
              if (isChestUrl(href)) dbeChestMaybeCount(href);
            }catch(_){}
            return _orig.apply(this, arguments);
          };
          AProto.__dbeChestClickWrapped = true;
        }
      }catch(_){}
      // <form>.submit() フック
      try{
        const FProto = window.HTMLFormElement && window.HTMLFormElement.prototype;
        if (FProto && !FProto.__dbeChestSubmitWrapped){
          const _orig = FProto.submit;
          FProto.submit = function(){
            try{
              const action = this && this.action;
              if (isChestUrl(action)) dbeChestMaybeCount(action);
            }catch(_){}
            return _orig.apply(this, arguments);
          };
          FProto.__dbeChestSubmitWrapped = true;
        }
      }catch(_){}
      // ──────────────────────────────────────────────
      // 追加：ユーザーのネイティブ操作も確実に拾うための捕捉リスナー
      //  - ユーザーが素で <a> をクリックして遷移するケース
      //  - ユーザーがボタンでフォーム送信する（= Form#submit は呼ばれない）ケース
      // キャプチャ段階で拾い、離脱前に分子を +1 しておく
      // ──────────────────────────────────────────────
      try{
        if (!DBE_CHEST._docClickCountHooked){
          document.addEventListener('click', function(ev){
            try{
              const t = ev.target;
              const a = t && (t.closest ? t.closest('a[href]') : null);
              const href = a && a.href;
              if (href && isChestUrl(href)) dbeChestMaybeCount(href);
            }catch(_){}
          }, true); // capture
          DBE_CHEST._docClickCountHooked = true;
        }
      }catch(_){}
      try{
        if (!DBE_CHEST._docSubmitCountHooked){
          document.addEventListener('submit', function(ev){
            try{
              const f = ev && ev.target;
              const action = f && f.action;
              if (action && isChestUrl(action)) dbeChestMaybeCount(action);
            }catch(_){}
          }, true); // capture
          DBE_CHEST._docSubmitCountHooked = true;
        }
      }catch(_){}
    }

    function dbeAppendLog(htmlOrText){
      let log = document.getElementById('dbe-chestprog-log');
      // ログ枠が未生成なら ChestProgressUI を確実に生成してから取得を再試行
      if (!log){
        try{
          const wnd = dbeEnsureChestProgressUI(); // 生成 or 取得
          if (wnd) log = document.getElementById('dbe-chestprog-log');
        }catch(_){}
      }
      if (!log){
        console.warn('[DBE][ChestProg] log mount missing: #dbe-chestprog-log');
        return;
      }
      const line = document.createElement('div');
      line.style.whiteSpace = 'pre-wrap'; // 折返し安全
      if (/<[a-z][\s\S]*>/i.test(htmlOrText)) line.innerHTML = htmlOrText;
      else line.textContent = htmlOrText;
      log.insertBefore(line, log.firstChild || null);
      log.scrollTop = 0;
    }

    function dbeApplyChestPlainLogStyle(line){
      if (!line) return line;
      Object.assign(line.style, {
        whiteSpace: 'pre-wrap',
        margin: '0 0 3px 0',
        padding: '3px 7px',
        borderRadius: '6px',
        backgroundColor: '#F3F3F3',
        color: '#555',
        fontWeight: '700',
        lineHeight: '1.25em',
        wordBreak: 'break-word'
      });
      return line;
    }

    function dbeAppendChestPlainLog(text){
      let log = document.getElementById('dbe-chestprog-log');
      // ログ枠が未生成なら ChestProgressUI を確実に生成してから取得を再試行
      if (!log){
        try{
          const wnd = dbeEnsureChestProgressUI();
          if (wnd) log = document.getElementById('dbe-chestprog-log');
        }catch(_){}
      }
      if (!log) return;

      const line = document.createElement('div');
      line.textContent = String(text || '');
      dbeApplyChestPlainLogStyle(line);
      log.insertBefore(line, log.firstChild || null);
      log.scrollTop = 0;
    }

    function dbeAppendNoMatchingLootLog(){
      let log = document.getElementById('dbe-chestprog-log');
      // ログ枠が未生成なら ChestProgressUI を確実に生成してから取得を再試行
      if (!log){
        try{
          const wnd = dbeEnsureChestProgressUI();
          if (wnd) log = document.getElementById('dbe-chestprog-log');
        }catch(_){}
      }
      if (!log) return;

      const line = document.createElement('div');
      line.textContent = DBE_CHEST_NO_MATCH_LOG_TEXT;
      dbeApplyChestPlainLogStyle(line);
      log.insertBefore(line, log.firstChild || null);
      log.scrollTop = 0;
    }

    function dbeAppendChestLogSeparator(){
      let log = document.getElementById('dbe-chestprog-log');
      // ログ枠が未生成なら ChestProgressUI を確実に生成してから取得を再試行
      if (!log){
        try{
          const wnd = dbeEnsureChestProgressUI();
          if (wnd) log = document.getElementById('dbe-chestprog-log');
        }catch(_){}
      }
      if (!log) return;

      const sep = document.createElement('div');
      sep.className = 'dbe-chestprog-separator';
      Object.assign(sep.style, {
        height: '0',
        borderTop: '2px dashed #BBBBBB',
        margin: '6px 0',
        opacity: '0.9'
      });
      // ログは常に上へ追加するため、同一開封分のログ行／該当なしメッセージを
      // 先に追加してから最後にセパレーターを追加すると、
      // 表示上は「セパレーター → 今回分ログ → 前回分ログ」の並びになる。
      log.insertBefore(sep, log.firstChild || null);
      log.scrollTop = 0;
    }

    function dbeAppendLootLogEntry(info){
      let log = document.getElementById('dbe-chestprog-log');
      if (!log){
        try{
          const wnd = dbeEnsureChestProgressUI();
          if (wnd) log = document.getElementById('dbe-chestprog-log');
        }catch(_){}
      }
      if (!log || !info) return;

      const line = document.createElement('div');
      const bg = info.bgColor || (info.kind === 'necklace' ? (GRD_COLOR[info.gradeKey] || '#EEE') : (RAR_COLOR[info.rarity] || '#EEE'));
      const fg = info.textColor || '#fff';
      Object.assign(line.style,{
        display:'flex',
        alignItems:'center',
        gap:'0.55em',
        flexWrap:'wrap',
        margin:'0 0 3px 0',
        padding:'3px 7px',
        borderRadius:'6px',
        backgroundColor:bg,
        color:fg,
        fontWeight:'700',
        lineHeight:'1.25em',
        wordBreak:'break-word'
      });

      const name = document.createElement('span');
      name.textContent = info.name || '';
      name.style.cssText = 'font-weight:700;';
      line.appendChild(name);

      if (info.kind === 'weapon' || info.kind === 'armor'){
        const elem = document.createElement('span');
        elem.textContent = dbeNormalizeElemText(info.elem) || 'なし';
        Object.assign(elem.style,{
          display:'inline-block',
          padding:'1px 0.45em',
          borderRadius:'999px',
          background:'rgba(255,255,255,0.86)',
          color:'#111',
          fontSize:'0.86em',
          fontWeight:'700',
          border:'1px solid rgba(0,0,0,0.22)'
        });
        line.appendChild(elem);
      }

      const marimo = document.createElement('span');
      marimo.textContent = info.marimo || '';
      marimo.style.cssText = 'margin-left:auto;font-weight:700;white-space:nowrap;';
      line.appendChild(marimo);

      log.insertBefore(line, log.firstChild || null);
      log.scrollTop = 0;
    }

    // ──────────────────────────────────────────────
    // onHold（= 保留）付与を検知してログを吐くオブザーバ
    //  - 出力対象は「簡易ログに表示する装備」設定に従う
    //  - 同一IDの重複ログは抑止
    // ──────────────────────────────────────────────
    function dbeInstallOnHoldLogObserver(){
      try{
        const DBE_CHEST = (window.DBE_CHEST = window.DBE_CHEST || {});
        if (DBE_CHEST._onholdObs) return; // 多重装着ガード
        const posted = (DBE_CHEST._onholdLogged = DBE_CHEST._onholdLogged || new Set());
        const getIdFromRow = (tr)=>{
          try{
            const a = tr.querySelector('a[href*="/equip/"]');
            const m = a && a.href && a.href.match(/\/equip\/(\d+)/);
            return m ? m[1] : null;
          }catch(_){ return null; }
        };
        const onRow = (tr)=>{
          if (!tr || !tr.classList || !tr.classList.contains('dbe-prm-Chest--onhold')) return;
          const id = getIdFromRow(tr);
          if (!id || posted.has(id)) return;
          posted.add(id);
          try{ dbeChestLogActionById(id, '保留'); }catch(_){}
        };
        const obs = new MutationObserver((muts)=>{
          try{
            muts.forEach(mu=>{
              if (mu.type === 'attributes' && mu.target && mu.attributeName==='class'){
                onRow(mu.target);
              }
              (mu.addedNodes||[]).forEach(n=>{
                if (n && n.nodeType===1){
                  if (n.matches && n.matches('tr.dbe-prm-Chest--onhold')) onRow(n);
                  // サブツリー内も走査
                  if (n.querySelectorAll){
                    n.querySelectorAll('tr.dbe-prm-Chest--onhold').forEach(onRow);
                  }
                }
              });
            });
          }catch(_){}
        });
        obs.observe(document.body, { subtree:true, childList:true, attributes:true, attributeFilter:['class'] });
        DBE_CHEST._onholdObs = obs;
      }catch(_){}
    }

    // ──────────────────────────────────────────────
    //  アクションログ出力のための判定＆取得ヘルパ
    //    - ネックレス: 詳細設定の Pt/Au/Ag/CuSn/Cu
    //    - 武器/防具 : 詳細設定の UR/SSR/SR/R/N
    // ──────────────────────────────────────────────
    function dbeChestIsDetailLogOn(){
      // 互換維持のため残置（常に false）
      return false;
    }
    function dbeChestShouldLogAction(info){
      try{
        if (!info) return false;
        if (info.kind === 'necklace'){
          const ent = DBE_CHEST_LOG_KEYS.grade[info.gradeKey];
          return ent ? dbeReadChestLogBool(ent) : false;
        }
        if (info.kind === 'weapon' || info.kind === 'armor'){
          const ent = DBE_CHEST_LOG_KEYS.rarity[info.rarity];
          return ent ? dbeReadChestLogBool(ent) : false;
        }
        return false;
      }catch(_){ return false; }
    }
    function dbeGetCellTextByHeader(tr, names){
      try{
        const table = tr && tr.closest ? tr.closest('table') : null;
        if (!table) return '';
        const map = (typeof headerMap === 'function') ? headerMap(table) : {};
        for (const name of names){
          const idx = map[name];
          if (idx != null && idx >= 0 && tr.cells[idx]){
            return (tr.cells[idx].textContent || '').trim();
          }
        }
      }catch(_){}
      return '';
    }
    function dbeNormalizeElemText(raw){
      const s = String(raw || '')
        .replace(/\u00A0/g, ' ')
        .replace(/\s+/g, '')
        .trim();
      if (!s) return '';
      if (s === 'なし') return 'なし';

      // ELEM列の想定値:
      //   25風 / 30火 / 84風 / なし
      // CRIT列の 5% / 0% などは、ここで必ず無効扱いにする。
      const m = s.match(/^(?:\d+)?(火|氷|雷|風|地|水|光|闇)$/);
      return m ? m[1] : '';
    }

    function dbeGetElemTextFromRow(tr){
      try{
        if (!tr) return 'なし';

        const table = tr.closest ? tr.closest('table') : null;
        const tableId = table ? String(table.id || '') : '';

        // ELEM列を明示的に指しているセルだけを読む。
        // headerMap() が列非表示や加工後DOMでずれるケースがあるため、
        // 「CRIT」など別列の値は dbeNormalizeElemText() 側でも弾く。
        function readElemFromIndex(idx){
          try{
            if (idx == null || idx < 0 || !tr.cells || !tr.cells[idx]) return '';
            return dbeNormalizeElemText(tr.cells[idx].textContent || '');
          }catch(_){
            return '';
          }
        }

        // 1) DBE が付与する列クラスから取得
        const cls =
          tableId === 'weaponTable' ? 'wepClm-Elem' :
          tableId === 'armorTable'  ? 'amrClm-Elem' : '';
        if (cls){
          const td = tr.querySelector(`td.${cls}`);
          const val = dbeNormalizeElemText(td ? td.textContent : '');
          if (val) return val;
        }

        // 2) th の表示名から ELEM 列位置を直接取得
        //    headerMap() ではなく、その場の thead th を走査する。
        if (table){
          const ths = Array.from(table.querySelectorAll('thead th'));
          const idx = ths.findIndex(th => String(th.textContent || '').trim() === 'ELEM');
          const val = readElemFromIndex(idx);
          if (val) return val;
        }

        // 3) 既存ヘルパ経由で取得
        //    ただし dbeNormalizeElemText() が 5% 等を空にするため、CRIT誤取得は無効化される。
        let val = dbeNormalizeElemText(dbeGetCellTextByHeader(tr, ['ELEM']));
        if (val) return val;

        // 4) サーバー返却HTMLの既定列位置で取得
        // weaponTable: 武器, 装, 解, ATK, SPD, CRIT, ELEM, MOD, マリモ, 分解
        // armorTable:  防具, 装, 解, DEF, WT., CRIT, ELEM, MOD, マリモ, 分解
        const fallbackIndex =
          tableId === 'weaponTable' ? 6 :
          tableId === 'armorTable'  ? 6 : -1;
        val = readElemFromIndex(fallbackIndex);
        if (val) return val;

        // 5) 最終フォールバック：
        // 「25風」「30火」「なし」など、ELEM列らしい値だけを行内セルから探す。
        // 「5%」のような CRIT 値は正規表現に一致しないため拾わない。
        const cells = Array.from(tr.cells || []);
        for (const td of cells){
          const s = String(td ? (td.textContent || '') : '').replace(/\s+/g, '').trim();
          if (!s) continue;
          const m = s.match(/^(?:\d+)?(火|氷|雷|風|地|水|光|闇|なし)$/);
          if (m) return m[1];
        }
      }catch(_){}
      return 'なし';
    }

    function dbeNormalizeMarimoText(raw){
      try{
        const s = String(raw || '')
          .replace(/\u00A0/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        if (!s) return '';
        const m = s.match(/([0-9][0-9,]*)\s*マ/);
        return m ? `${m[1]} マ` : '';
      }catch(_){
        return '';
      }
    }

    function dbeGetMarimoTextFromRow(tr){
      try{
        if (!tr) return '';

        // 1) まず既存のヘッダー名ベースで取得
        let raw = dbeGetCellTextByHeader(tr, ['マリモ']);
        let val = dbeNormalizeMarimoText(raw);
        if (val) return val;

        const table = tr.closest ? tr.closest('table') : null;
        const tableId = table ? String(table.id || '') : '';

        // 2) DBE が付与する列クラスから取得
        const cls =
          tableId === 'necklaceTable' ? 'necClm-Mrim' :
          tableId === 'weaponTable'   ? 'wepClm-Mrim' :
          tableId === 'armorTable'    ? 'amrClm-Mrim' : '';
        if (cls){
          const td = tr.querySelector(`td.${cls}`);
          val = dbeNormalizeMarimoText(td ? td.textContent : '');
          if (val) return val;
        }

        // 3) サーバー返却HTMLの既定列位置で取得
        // necklaceTable: ネックレス, 装, 解, 属性, MOD, マリモ, 分解
        // weaponTable:   武器, 装, 解, ATK, SPD, CRIT, ELEM, MOD, マリモ, 分解
        // armorTable:    防具, 装, 解, DEF, WT., CRIT, ELEM, MOD, マリモ, 分解
        const fallbackIndex =
          tableId === 'necklaceTable' ? 5 :
          tableId === 'weaponTable'   ? 8 :
          tableId === 'armorTable'    ? 8 : -1;
        if (fallbackIndex >= 0 && tr.cells && tr.cells[fallbackIndex]){
          val = dbeNormalizeMarimoText(tr.cells[fallbackIndex].textContent || '');
          if (val) return val;
        }

        // 4) 最終フォールバック：行内セルから「数値 マ」形式のセルを直接探す
        const cells = Array.from(tr.cells || []);
        for (const td of cells){
          val = dbeNormalizeMarimoText(td ? td.textContent : '');
          if (val) return val;
        }
      }catch(_){}
      return '';
    }

    function dbeChestBuildLogInfoFromRow(tr){
      try{
        if (!tr) return null;
        const nameTd = Array.from(tr.cells || []).find(td => td.querySelectorAll('span').length >= 2)
                    || tr.cells?.[0] || null;
        if (!nameTd) return null;
        const info = dbeParseNameTd(nameTd);
        if (!info) return null;
        let cs = null;
        try{ cs = getComputedStyle(nameTd); }catch(_){}
        info.bgColor = nameTd.style.backgroundColor || (cs && cs.backgroundColor) || '';
        info.textColor = nameTd.style.color || (cs && cs.color) || '';
        info.marimo = dbeGetMarimoTextFromRow(tr);
        if (info.kind === 'weapon' || info.kind === 'armor'){
          info.elem = dbeGetElemTextFromRow(tr);
        }
        return info;
      }catch(_){
        return null;
      }
    }
    function dbeChestFindRowInfoByItemIdInMain(id){
      try{
        id = String(id||'').trim();
        if (!id) return null;
        const sels = ['#weaponTable','#armorTable','#necklaceTable'];
        for (const sel of sels){
          const table = document.querySelector(sel);
          if (!table || !table.tBodies || !table.tBodies[0]) continue;
          const rows = Array.from(table.tBodies[0].rows||[]);
          for (const tr of rows){
            const a = tr.querySelector('a[href*="/equip/"]');
            const m = a && a.href && a.href.match(/\/equip\/(\d+)/);
            if (m && m[1] === id){
              const info = dbeChestBuildLogInfoFromRow(tr);
              if (info) return info;
            }
          }
        }
      }catch(_){}
      return null;
    }
    function dbeChestLogActionById(id, actionJa){
      try{
        const info = dbeChestFindRowInfoByItemIdInMain(id);
        if (!info) return;
        if (!dbeChestShouldLogAction(info)) return;
        dbeAppendLootLogEntry(info);
      }catch(_){}
    }

    function dbeLootLineNecklace(name, gradeKey, numberStr){
      const color = GRD_COLOR[gradeKey] || '#333';
      const suffix = (typeof numberStr!=='undefined' && numberStr!==null) ? String(numberStr) : '';
      return `<span style="color:${color}">${name} [${gradeKey}${suffix}]</span>`;
    }
    function dbeLootLineEquip(name, rarity){
      const color = RAR_COLOR[rarity] || '#333';
      return `<span style="color:${color}">${name} [${rarity}]</span>`;
    }
    // --- DOM 解析ヘルパ：名称セル(td)から種別／名称／グレード/レアを抽出 ---
    function dbeParseNameTd(td){
      try{
        // 想定構造：<td> <span style="font-weight:600;">名前</span><br>
        //               <span style="font-size:0.7em;">【種別】 [Pt6|Au5|UR|SSR]</span> </td>
        const spans = td.querySelectorAll('span');
        if (spans.length < 2) return null;
        const rawName = (spans[0].textContent || '').trim();
        const name = dbeStripLegacyGenerationMark(rawName);
        const legacy = dbeIsLegacyGenerationName(rawName);
        const generation = legacy ? 'legacy' : 'synergy';
        const meta = (spans[1].textContent || '').trim();
        // ネックレス（Pt/Au/Ag/CuSn/Cu + 数字）
        let m = meta.match(/【\s*ネックレス\s*】\s*\[\s*(Pt|Au|Ag|CuSn|Cu)\s*(\d+)\s*\]/);
        if (m){
          return { kind:'necklace', gradeKey:m[1], number:m[2], name:rawName, rawName, legacy:false, generation:'synergy' };
        }
        // 武器/防具（UR/SSR）
        m = meta.match(/【\s*(武器|防具)\s*】\s*\[\s*(UR|SSR|SR|R|N)\s*\]/);
        if (m){
          const jkind = m[1]; const rarity = m[2];
          const kind = (jkind === '武器') ? 'weapon' : 'armor';
          return { kind, name, rawName, rarity, legacy, generation };
        }
        return null;
      }catch(_){ return null; }
    }
    // --- DOM 解析：iframe 内の「onlyNew」マーキング行だけを走査して対象をログ出力 ---
    function dbeScanAndLogLoot(doc){
      try{
        if (!doc) return;
        const DBE_CHEST = (window.DBE_CHEST = window.DBE_CHEST || {});
        const posted = (DBE_CHEST._onlyNewLogged = DBE_CHEST._onlyNewLogged || new Set());
        // 対象テーブルに限定して「onlyNew」が付与された行だけを拾う
        const tables = ['#weaponTable','#armorTable','#necklaceTable']
          .map(sel => doc.querySelector(sel))
          .filter(Boolean);
        const rows = tables.flatMap(tbl => Array.from(tbl.tBodies?.[0]?.rows || []))
          .filter(tr => tr.classList?.contains('onlyNew'));
        for (const tr of rows){
          const itemId = dbeChestGetItemIdFromRow(tr);
          if (!itemId) continue;
          if (posted.has(itemId)) continue;
          const info = dbeChestBuildLogInfoFromRow(tr);
          if (!info) continue;
          if (dbeChestShouldLogAction(info)){
            dbeAppendLootLogEntry(info);
            posted.add(itemId);
            chestDiag && chestDiag('lootObserver: logged loot', info);
          }
        }
      }catch(_){}
    }

    function dbeChestGetItemIdFromRow(tr){
      try{
        if (!tr) return '';
        const a = tr.querySelector('a[href*="/equip/"]');
        const href = a ? String(a.getAttribute('href') || a.href || '') : '';
        const m = href.match(/\/equip\/(\d+)/);
        return m ? m[1] : '';
      }catch(_){
        return '';
      }
    }

    function dbeChestCloneDocTablesForLootDiff(sourceDoc, kind){
      try{
        const src = sourceDoc || document;
        const ids = dbeChestLootTableIdsForKind(kind);
        const html = [
          '<!doctype html><html><head><meta charset="UTF-8"></head><body>',
          ids.map(id=>{
            const table = src.getElementById ? src.getElementById(id) : null;
            return table ? table.outerHTML : '';
          }).join('\n'),
          '</body></html>'
        ].join('');
        return new DOMParser().parseFromString(html, 'text/html');
      }catch(_){
        return null;
      }
    }

    function dbeChestCloneCurrentBagDocForLootDiff(kind){
      try{
        const DBE_CHEST = (window.DBE_CHEST = window.DBE_CHEST || {});
        // v12.0.1.11:
        // backgroundBagTables=true の連続開封では、実ページ側の /bag テーブルを更新しない。
        // そのため、2回目以降の差分取得では、直前ループ終了時に保存した
        // iframe 内 /bag DOM のスナップショットを比較元として使う。
        const sourceDoc =
          (DBE_CHEST.backgroundBagTables && DBE_CHEST._backgroundBagSnapshotDoc)
            ? DBE_CHEST._backgroundBagSnapshotDoc
            : document;
        return dbeChestCloneDocTablesForLootDiff(sourceDoc, kind);
      }catch(_){
        return null;
      }
    }

    function dbeChestRememberLootBeforeOpen(kind){
      try{
        const DBE_CHEST = (window.DBE_CHEST = window.DBE_CHEST || {});
        DBE_CHEST._lootBeforeOpen = {
          kind,
          at: Date.now(),
          // v12.0.1.11:
          // 実ページ側 /bag を書き換えない連続開封では、
          // 直前ループ終了時の iframe 側 /bag スナップショットを比較元にする。
          // 初回などスナップショットが無い場合だけ、実ページ側 document を使う。
          doc: dbeChestCloneCurrentBagDocForLootDiff(kind)
        };
      }catch(_){}
    }

    function dbeChestCollectIdsFromDocTables(doc, tableIds){
      const ids = new Set();
      try{
        if (!doc || !Array.isArray(tableIds)) return ids;
        tableIds.forEach(id=>{
          const table = doc.getElementById(id);
          const body = table && table.tBodies && table.tBodies[0];
          if (!body) return;
          Array.from(body.rows || []).forEach(tr=>{
            const itemId = dbeChestGetItemIdFromRow(tr);
            if (itemId) ids.add(itemId);
          });
        });
      }catch(_){}
      return ids;
    }

    function dbeChestAppendLootLogFromHtmlDiff(kind, beforeDoc, afterDoc){
      try{
        if (!beforeDoc || !afterDoc) return;
        const DBE_CHEST = (window.DBE_CHEST = window.DBE_CHEST || {});
        const tableIds = dbeChestLootTableIdsForKind(kind);
        const beforeIds = dbeChestCollectIdsFromDocTables(beforeDoc, tableIds);
        const posted = (DBE_CHEST._onlyNewLogged = DBE_CHEST._onlyNewLogged || new Set());
        let newLootCount = 0;
        let appendedLootCount = 0;

        tableIds.forEach(tableId=>{
          const table = afterDoc.getElementById(tableId);
          const body = table && table.tBodies && table.tBodies[0];
          if (!body) return;

          Array.from(body.rows || []).forEach(tr=>{
            try{
              const itemId = dbeChestGetItemIdFromRow(tr);
              if (!itemId) return;
              if (beforeIds.has(itemId)) return;

              // 後続の既存 onlyNew 系処理とも整合するよう、返却HTML側の行にも印を付ける
              try{
                tr.classList.add('dbe-prm-Chest--onlynew');
                tr.classList.add('onlyNew');
                if (tr.dataset) tr.dataset.dbeOnlynew = '1';
              }catch(_){}

              if (posted.has(itemId)) return;
              const info = dbeChestBuildLogInfoFromRow(tr);
              if (!info) return;

              // 宝箱なら武器/防具のみ、バトル宝箱ならネックレスのみをログ対象にする
              if (dbeChestIsBattleKind(kind)){
                if (info.kind !== 'necklace') return;
              } else {
                if (!(info.kind === 'weapon' || info.kind === 'armor')) return;
              }

              // ここまで来たものは「今回の開封で新たに入手した装備」として数える。
              // ただし詳細設定の表示条件に合わない場合は、装備行自体は表示せず、
              // その開封で1件もログ表示されなかった場合にだけ案内文を表示する。
              newLootCount++;
              if (!dbeChestShouldLogAction(info)){
                // 表示対象外でも、同じ itemId を後続の onlyNew 監視側が再評価して
                // 「該当なし」やログ行を二重生成しないよう、処理済みにしておく。
                posted.add(itemId);
                return;
              }
              dbeAppendLootLogEntry(info);
              posted.add(itemId);
              appendedLootCount++;
              chestDiag && chestDiag('lootDiff: logged new loot', { itemId, info });
            }catch(_){}
          });
        });
        if (newLootCount > 0){
          if (appendedLootCount === 0){
            dbeAppendNoMatchingLootLog();
            chestDiag && chestDiag('lootDiff: new loot exists but no item matched detail settings', { kind, newLootCount });
          }
          // ログは上へ積む仕様なので、今回分の装備行／該当なしメッセージを
          // 追加したあと最後にセパレーターを挿入する。
          // これにより、装備ログあり／該当なしのどちらでもセパレーター位置が揃う。
          dbeAppendChestLogSeparator();
        }
      }catch(err){
        console.warn('[DBE] dbeChestAppendLootLogFromHtmlDiff failed:', err);
      }
    }

    function dbeChestAppendLootLogForReturnedBag(kind, afterDoc){
      try{
        const DBE_CHEST = (window.DBE_CHEST = window.DBE_CHEST || {});
        const snap = DBE_CHEST._lootBeforeOpen;
        const useKind = kind || snap?.kind || DBE_CHEST.type;

        // v12.0.1.11:
        // 開封直後に返ってきた /bag も保存しておく。
        // このあとロック／分解でさらに /bag が更新された場合は afterIterationStep() 側で上書きする。
        try{
          if (DBE_CHEST.backgroundBagTables && afterDoc){
            DBE_CHEST._backgroundBagSnapshotDoc = dbeChestCloneDocTablesForLootDiff(afterDoc, useKind);
          }
        }catch(_){}

        if (!snap || !snap.doc) return;
        dbeChestAppendLootLogFromHtmlDiff(useKind, snap.doc, afterDoc);
      }catch(_){}
      finally{
        try{ (window.DBE_CHEST = window.DBE_CHEST || {})._lootBeforeOpen = null; }catch(_){}
      }
    }

    // ──────────────────────────────────────────────
    // Chest 簡易ログ API
    //  - この IIFE の外側にある dbeSubmitChestOpenElement() / onBgFrameLoad()
    //    / updateNewbieBadgesAfterChest() から安全に呼び出すための公開口。
    //  - v12.0.1.0 では IIFE 内ローカル関数を外側から直接呼んでいたため、
    //    ReferenceError が try-catch で握りつぶされ、ログ欄が真っ白になる原因になっていた。
    // ──────────────────────────────────────────────
    window.DBE_chestLootApi = Object.assign(window.DBE_chestLootApi || {}, {
      isBattleKind: dbeChestIsBattleKind,
      rememberBeforeOpen: dbeChestRememberLootBeforeOpen,
      appendForReturnedBag: dbeChestAppendLootLogForReturnedBag,
      buildLogInfoFromRow: dbeChestBuildLogInfoFromRow,
      shouldLogAction: dbeChestShouldLogAction,
      appendLootLogEntry: dbeAppendLootLogEntry
    });

    // 取得結果（iframe）監視：ロード毎に DOM を解析してログ出力
    function dbeAttachLootObserver(){
      const DBE_CHEST = (window.DBE_CHEST = window.DBE_CHEST || {});
      if (!DBE_CHEST.iframe || DBE_CHEST._lootObserved) return;
      try{
        const ifr = DBE_CHEST.iframe;
        chestDiag('lootObserver: attach to iframe');
        const onload = ()=>{
          try{
            const doc = ifr.contentDocument || ifr.contentWindow?.document;
            if (!doc) return;
            dbeScanAndLogLoot(doc);
            chestDiag('lootObserver: iframe load -> scanned');
          }catch(_){}
        };
        ifr.removeEventListener('load', onload);
        ifr.addEventListener('load', onload);
        DBE_CHEST._lootObserved = true;
        chestDiag('lootObserver: attached OK');
      }catch(_){}
    }
    // 進行UIの開始／終了制御
    function dbeStartProgressUI(type){
      const DBE_CHEST = (window.DBE_CHEST = window.DBE_CHEST || {});
      const wnd = dbeEnsureChestProgressUI();
      // 前回終了後のボタン状態を初期状態へ戻す
      try{
        DBE_CHEST._userClosing = false;
        const btnAbort = document.getElementById('dbe-chestprog-abort');
        const btnClose = document.getElementById('dbe-chestprog-close');
        if (btnAbort){
          btnAbort.disabled = false;
          btnAbort.textContent = '中断する';
          btnAbort.style.opacity = '1';
          btnAbort.style.cursor = 'pointer';
          btnAbort.style.filter = '';
        }
        if (btnClose){
          btnClose.disabled = true;
          btnClose.style.opacity = '0.5';
          btnClose.style.cursor = 'default';
        }
      }catch(_){}
      dbeSetProgressHeader(type);
      dbeUpdateCount();
      // 進行中：閉じる無効（オーバーレイは使用しない）
      wnd.style.display='inline-block';
      dbeBringToFront(wnd);
      chestDiag('progressUI: START', {type, unlimited:DBE_CHEST.unlimited, total:DBE_CHEST._totalPlanned});
      // ▼ ハードリロード抑止を有効化（finish で要求されても保留し、「閉じる」で実行）
      try{ if (window.__DBE_RELOAD_GUARD && typeof window.__DBE_RELOAD_GUARD.enable==='function'){ window.__DBE_RELOAD_GUARD.enable(); } }catch(_){}
      // カウントアップは「left」の減少を監視して逆算
      let prevLeft = DBE_CHEST.left;
      clearInterval(DBE_CHEST._progressTimer);
      DBE_CHEST._progressTimer = setInterval(()=>{
        try{
          dbeAttachLootObserver();
          // 分子は「送出時」に加算済み。ここでは表示更新のみ。
          dbeUpdateCount();
        }catch(_){}
      }, 300);
    }
    // 公開：他所からも開始UIを呼べるように
    window.DBE_StartProgressUI = dbeStartProgressUI;

    function dbeFinishProgressUI(){
      const DBE_CHEST = (window.DBE_CHEST = window.DBE_CHEST || {});
      clearInterval(DBE_CHEST._progressTimer); DBE_CHEST._progressTimer = null;
      // (12) 正常終了メッセージ（ユーザー中断／サーバーエラー時は表示しない）
      try{
        if (!DBE_CHEST._userAbort && !DBE_CHEST._serverError){
          dbeAppendChestPlainLog('プロセスは正常に終了しました');
        }
      }catch(_){}
      // 終了後の操作状態：
      // - 「中断する」はもう意味がないため非アクティブ化
      // - 「閉じる」は押せるようにする
      try{
        const btnAbort = document.getElementById('dbe-chestprog-abort');
        const btnClose = document.getElementById('dbe-chestprog-close');
        if (btnAbort){
          btnAbort.disabled = true;
          btnAbort.style.opacity = '0.45';
          btnAbort.style.cursor = 'default';
          btnAbort.style.filter = 'grayscale(100%)';
          btnAbort.textContent = '中断する';
        }
        if (btnClose){ btnClose.disabled = false; btnClose.style.opacity='1'; btnClose.style.cursor='pointer'; }
      }catch(_){}
      // オーバーレイは使用しない
      // 自動では閉じない：ウインドウは表示を維持し、ユーザーが「閉じる」を押すまで残す
      try{
        const wnd = document.getElementById('dbe-W-ChestProgress');
        if (wnd){ wnd.style.display = 'inline-block'; }
      }catch(_){}
      chestDiag('progressUI: FINISH (close enabled, window kept open)');
    }
    // 公開：他所からも終了UIを畳めるように
    window.DBE_FinishProgressUI = dbeFinishProgressUI;

    // ──────────────────────────────────────────────
    //  ハードリロード抑止ガード
    //    - start 時に enable()
    //    - Progress の「閉じる」押下時は実リロードせず、
    //      disable({executePending:false}) 後に /bag 本体だけを再取得・差し替え
    //    - 外部が location.reload() を呼んでも保留
    // ──────────────────────────────────────────────
    (function(){
      if (window.__DBE_RELOAD_GUARD) return; // 多重定義防止
      const guard = {
        _enabled:false,
        _pending:false,
        _origReload:null,
        _origReplace:null,
        _origAssign:null,
        enable(){
          if (this._enabled) return;
          this._enabled = true;
          // reload をフック
          try{
            if (!this._origReload) this._origReload = window.location.reload.bind(window.location);
            const self = this;
            window.location.reload = function(){
              self._pending = true;
              chestDiag('reload-guard: captured location.reload() -> pending');
            };
          }catch(_){}
          // replace/assign も代表的にフック（完全ではないが多くのケースを吸収）
          try{
            if (!this._origReplace) this._origReplace = window.location.replace.bind(window.location);
            const self = this;
            window.location.replace = function(){
              self._pending = true;
              chestDiag('reload-guard: captured location.replace(...) -> pending');
            };
          }catch(_){}
          try{
            if (!this._origAssign) this._origAssign = window.location.assign.bind(window.location);
            const self = this;
            window.location.assign = function(){
              self._pending = true;
              chestDiag('reload-guard: captured location.assign(...) -> pending');
            };
          }catch(_){}
        },
        disable(opt){
          const exec = !!(opt && opt.executePending);
          // 元に戻す
          try{ if (this._origReload)  window.location.reload  = this._origReload;  }catch(_){}
          try{ if (this._origReplace) window.location.replace = this._origReplace; }catch(_){}
          try{ if (this._origAssign)  window.location.assign  = this._origAssign;  }catch(_){}
          const wasPending = this._pending;
          this._enabled = false;
          this._pending = false;
          chestDiag('reload-guard: disabled. pending=', wasPending, ' executeNow=', exec);
          if (exec && wasPending){
            try{
              // 実リロードを「今」実行
              this._origReload ? this._origReload() : window.location.reload();
            }catch(_){
              // 保険：失敗したら通常APIで
              try{ window.location.reload(); }catch(__){}
            }
          }
        }
      };
      window.__DBE_RELOAD_GUARD = guard;
    })();

    // 既存 startChestProcess / DBE_finishChest を「必ず」ラップできるよう遅延フックを実装
    (function wrapChestFlow(){
      const DBE_CHEST = (window.DBE_CHEST = window.DBE_CHEST || {});
      chestDiag('wrapChestFlow: begin');

      // 共通：startChestProcess のラッパ本体
      function __wrapStart(orig){
        if (orig && orig.__dbeWrappedForProgress) return orig;
        const wrapped = function(type){
          try{
            // 事前初期化（回数の読み取り）
            const rLimited   = document.getElementById('dbe-radio-Chest--limited');
            const rUnlimited = document.getElementById('dbe-radio-Chest--unlimited');
            const nTimes     = document.getElementById('dbe-prm-Chest--open-times');
            const runCount   = Math.max(1, Number(nTimes?.value || 1));

            DBE_CHEST.unlimited     = !!(rUnlimited && rUnlimited.checked);
            // 分母：標準/大型/バトル標準/バトル大型のいずれも「ボタン実行回数」をそのまま使う
            DBE_CHEST._totalPlanned = DBE_CHEST.unlimited ? null : runCount;
            DBE_CHEST.processed     = 0;
            DBE_CHEST._userAbort    = false;
            DBE_CHEST._serverError  = false;
            // 自動実行フラグ ON（この間だけカウント対象）
            DBE_CHEST._autoRunning  = true;
            // (4) onHold / onlyNew / 🔰 を開始時にクリア
            try{
              // onHold クラス除去
              document.querySelectorAll('tr.dbe-prm-Chest--onhold').forEach(tr=>tr.classList.remove('dbe-prm-Chest--onhold'));
              // onlyNew マーキング（将来拡張を含む）除去
              document.querySelectorAll('tr.dbe-prm-Chest--onlynew,[data-dbe-onlynew="1"]').forEach(tr=>{
                tr.classList.remove('dbe-prm-Chest--onlynew');
                if (tr.dataset) delete tr.dataset.dbeOnlynew;
              });
              // 🔰（newbie）除去：name-badge API が存在すれば利用
              if (typeof window.DBE_setNameBadge === 'object' && window.DBE_setNameBadge){
                ['#weaponTable','#armorTable','#necklaceTable'].forEach(sel=>{
                  const tb = document.querySelector(sel);
                  if (!tb || !tb.tBodies || !tb.tBodies[0]) return;
                  Array.from(tb.tBodies[0].rows||[]).forEach(tr=>{
                    const nameTd = Array.from(tr.cells||[]).find(td => td.querySelectorAll('span').length>=2) || tr.cells?.[0] || null;
                    if (nameTd) try{ window.DBE_setNameBadge.newbie(nameTd, false); }catch(_){}
                  });
                });
              }
            }catch(_){}
            // （詳細ログ UI は廃止）
            // (5) onHold 付与検知 → ログ出力
            // 分子カウント用のフックを装着（fetch/a.click/form.submit を監視）
            try{ dbeInstallChestCountHooks(); }catch(_){}
            // ▼ リロード抑止を確実に有効化（ここでも保険で有効化）
            try{ if (window.__DBE_RELOAD_GUARD && typeof window.__DBE_RELOAD_GUARD.enable==='function'){ window.__DBE_RELOAD_GUARD.enable(); } }catch(_){}
            dbeStartProgressUI(type);
            chestDiag('startChestProcess(wrapped): called with type=', type);
          }catch(_){}
          // 事前選別の有無は startChestProcess() 側に集約する。
          // ここで旧IDに基づく判定を行うと、includeUnlocked OFF でも手持ち選別が走るため何もしない。
          const ret = orig ? orig.apply(this, arguments) : undefined;
          // 進行監視：iframe 監視装着トライ
          setTimeout(()=>{ try{ dbeAttachLootObserver(); }catch(_){} }, 0);
          return ret;
        };
        Object.defineProperty(wrapped, '__dbeWrappedForProgress', { value:true });
        chestDiag('wrapChestFlow: startChestProcess wrapped');
        return wrapped;
      }

      // ★追加：DBE_startChestProxy のラッパ（送出直前の最終ゲート）
      function __wrapProxy(origP){
        if (origP && origP.__dbeWrappedForProgress) return origP;
        const wrappedP = function(){
          return origP ? origP.apply(this, arguments) : undefined;
        };
        Object.defineProperty(wrappedP, '__dbeWrappedForProgress', { value:true });
        chestDiag('wrapChestFlow: DBE_startChestProxy wrapped');
        return wrappedP;
      }

      // 共通：DBE_finishChest のラッパ本体
      function __wrapFinish(origF){
        if (origF && origF.__dbeWrappedForProgress) return origF;
        const wrappedF = function(){
          try{ (window.DBE_CHEST = window.DBE_CHEST || {})._autoRunning = false; }catch(_){}
          try{ dbeFinishProgressUI(); }catch(_){}
          chestDiag('DBE_finishChest(wrapped): called');
          return origF ? origF.apply(this, arguments) : undefined;
        };
        Object.defineProperty(wrappedF, '__dbeWrappedForProgress', { value:true });
        chestDiag('wrapChestFlow: DBE_finishChest wrapped');
        return wrappedF;
      }

      // 1) すでに存在するなら即ラップ
      if (typeof window.startChestProcess === 'function' && !window.startChestProcess.__dbeWrappedForProgress){
        window.startChestProcess = __wrapStart(window.startChestProcess);
        chestDiag('wrapChestFlow: immediate wrap of existing startChestProcess');
      }
      if (typeof window.DBE_startChestProxy === 'function' && !window.DBE_startChestProxy.__dbeWrappedForProgress){
        window.DBE_startChestProxy = __wrapProxy(window.DBE_startChestProxy);
        chestDiag('wrapChestFlow: immediate wrap of existing DBE_startChestProxy');
      }
      if (typeof window.DBE_finishChest === 'function' && !window.DBE_finishChest.__dbeWrappedForProgress){
        window.DBE_finishChest = __wrapFinish(window.DBE_finishChest);
        chestDiag('wrapChestFlow: immediate wrap of existing DBE_finishChest');
      }
      if (typeof window.DBE_finishChest !== 'function'){
        // フォールバック：まだ無い場合はプレースホルダを入れておく
        window.DBE_finishChest = __wrapFinish(null);
        chestDiag('wrapChestFlow: installed placeholder DBE_finishChest');
      }

      // 2) 後から代入される場合に備えて「setter」で捕まえてラップ
      try{
        if (!window.startChestProcess || !window.startChestProcess.__dbeWrappedForProgress){
          let _scp = typeof window.startChestProcess === 'function' ? window.startChestProcess : null;
          Object.defineProperty(window, 'startChestProcess', {
            configurable: true,
            get(){ return _scp || null; },
            set(fn){
              _scp = __wrapStart(fn);
              chestDiag('wrapChestFlow: setter captured startChestProcess');
            }
          });
        }
      }catch(_){}
      try{
        if (!window.DBE_startChestProxy || !window.DBE_startChestProxy.__dbeWrappedForProgress){
          let _prx = typeof window.DBE_startChestProxy === 'function' ? window.DBE_startChestProxy : null;
          Object.defineProperty(window, 'DBE_startChestProxy', {
            configurable: true,
            get(){ return _prx || null; },
            set(fn){
              _prx = __wrapProxy(fn);
              chestDiag('wrapChestFlow: setter captured DBE_startChestProxy');
            }
          });
        }
      }catch(_){}
      try{
        if (!window.DBE_finishChest || !window.DBE_finishChest.__dbeWrappedForProgress){
          let _fin = typeof window.DBE_finishChest === 'function' ? window.DBE_finishChest : null;
          Object.defineProperty(window, 'DBE_finishChest', {
            configurable: true,
            get(){ return _fin || null; },
            set(fn){
              _fin = __wrapFinish(fn);
              chestDiag('wrapChestFlow: setter captured DBE_finishChest');
            }
          });
        }
      }catch(_){}

      // 3) 念のための保険：一定時間だけポーリングし、未ラップなら捕捉
      (function pollWrap(attempt=0){
        try{
          if (typeof window.startChestProcess === 'function' && !window.startChestProcess.__dbeWrappedForProgress){
            window.startChestProcess = __wrapStart(window.startChestProcess);
            chestDiag('wrapChestFlow: poll', attempt, 'wrapped startChestProcess');
          }
          if (typeof window.DBE_startChestProxy === 'function' && !window.DBE_startChestProxy.__dbeWrappedForProgress){
            window.DBE_startChestProxy = __wrapProxy(window.DBE_startChestProxy);
            chestDiag('wrapChestFlow: poll', attempt, 'wrapped DBE_startChestProxy');
          }
          if (typeof window.DBE_finishChest === 'function' && !window.DBE_finishChest.__dbeWrappedForProgress){
            window.DBE_finishChest = __wrapFinish(window.DBE_finishChest);
            chestDiag('wrapChestFlow: poll', attempt, 'wrapped DBE_finishChest');
          }
        }catch(_){}
        if (attempt < 40){ // 約8秒（300ms×40）の保険
          setTimeout(()=>pollWrap(attempt+1), 300);
        } else {
          const hasStart = typeof window.startChestProcess === 'function' && !!window.startChestProcess.__dbeWrappedForProgress;
          const hasProxy = typeof window.DBE_startChestProxy === 'function' && !!window.DBE_startChestProxy.__dbeWrappedForProgress;
          const hasFin   = typeof window.DBE_finishChest === 'function' && !!window.DBE_finishChest.__dbeWrappedForProgress;
          chestDiag('wrapChestFlow: poll finished. wrapped?', { start:hasStart, proxy:hasProxy, finish:hasFin });
        }
      })();
    })();
  })();
  // ============================================================
  // △追加ここまで△ 宝箱：進行ウインドウ＆ログ
  // ============================================================

  // =========================
  // /bag ページ本体だけを再取得して最新化（dbe-W-* モーダルは維持）
  // =========================
  async function dbeRefreshBagPageMainFromServer(){
    const res = await fetch(`${DBE_ORIGIN}/bag`, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      redirect: 'follow',
      headers: { 'Accept': 'text/html,application/xhtml+xml,*/*' }
    });
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const ids = ['necklaceTable','weaponTable','armorTable'];
    let replaced = 0;

    ids.forEach(id=>{
      const newEl = doc.getElementById(id);
      const oldEl = document.getElementById(id);
      if (!newEl || !oldEl) return;
      oldEl.replaceWith(newEl.cloneNode(true));
      replaced++;
    });

    if (replaced === 0){
      throw new Error('/bag の主要テーブルを取得できませんでした。');
    }

    // 差し替えた生テーブルへ DBE の加工・イベントを再適用
    try{ tableIds.forEach(id=>processTable(id)); }catch(err){ console.warn('[DBE] processTable after /bag refresh failed:', err); }
    try{ initLockToggle(); }catch(_){}
    try{ initEquip(); }catch(_){}
    try{ initRecycle(); }catch(_){}
    try{ initBulkRecycle(); }catch(_){}

    // 表示設定を再反映
    try{ toggleDeltaColumn(readBool('showDelta')); }catch(_){}
    try{ toggleNameSubLine(readBool('hideKindClass')); }catch(_){}
    try{ toggleLockColumn(readBool('hideLockCol')); }catch(_){}
    try{
      const hideRecycle = readBool('hideRyclCol');
      tableIds.forEach(id=>{
        document.querySelectorAll(`.${columnIds[id]['分解']}`).forEach(el=>el.style.display = hideRecycle ? 'none' : '');
      });
    }catch(_){}
    try{ toggleItemIdColumn(readBool('displayItemId')); }catch(_){}
    try{ applyCellColors(); }catch(_){}
    try{ syncMenuFromStorage(); }catch(_){}
    try{ ensureHideAllControlInRecycle(); }catch(_){}
    try{ dbeRefreshBagItemSummaryText(); }catch(_){}

    chestDiag('refreshBagPageMainFromServer: updated /bag main tables', { replaced });
  }

  function dbeRefreshBagItemSummaryText(){
    const countRows = (id)=>{
      const table = document.getElementById(id);
      return table?.tBodies?.[0]?.rows?.length || 0;
    };
    const n = countRows('necklaceTable');
    const w = countRows('weaponTable');
    const a = countRows('armorTable');
    const total = n + w + a;

    const totalLine = Array.from(document.querySelectorAll('div'))
      .find(el => /^所持アイテム総数：/.test((el.textContent || '').trim()));
    if (totalLine){
      totalLine.textContent = `所持アイテム総数：${total}`;
      const detailLine = totalLine.nextElementSibling;
      if (detailLine){
        detailLine.textContent = `（ネックレス：${n}個／武器：${w}個／防具：${a}個）`;
      }
    }
  }

  // =========================
  // Chest ウインドウ専用：閉じるだけ（ページ再読み込みはしない）
  // =========================
  function dbeCloseChestWindow(wnd){
    try{
      const chestWnd = wnd || document.getElementById('dbe-W-Chest');
      if (chestWnd){
        chestWnd.style.display = 'none';
        if (chestWnd.dataset && chestWnd.dataset.dbeFronted === '1') {
          delete chestWnd.dataset.dbeFronted;
        }
      }
    }catch(_){}

    // Chest 本体を閉じるだけなので、pending reload は実行しない
    try{
      if (window.__DBE_RELOAD_GUARD && typeof window.__DBE_RELOAD_GUARD.disable === 'function'){
        window.__DBE_RELOAD_GUARD.disable({ executePending:false });
      }
    }catch(_){}

    try{ dbeHideOverlay(); }catch(_){
      try{ hideOverlay(); }catch(__){}
    }
  }

  // =========================
  // 共通：ウインドウシェルの確保
  // =========================
  function ensureWindowShell(wndID){
    let wnd = document.getElementById(wndID);
    if (wnd){ chestDiag('ensureWindowShell: reuse', wndID); return wnd; }
    wnd = document.createElement('div');
    wnd.id = wndID;
    // 主要ウインドウ(dbe-W-*)は windowsCommon を適用。ダイアログは dialogCommon を維持。
    if (/^dbe-W-/.test(wndID)) {
      wnd.classList.add('windowsCommon');
      // 念のためダイアログ系のベースクラスが付いていれば外す
      wnd.classList.remove('dialogCommon', 'dialogAlert', 'confirmCommon', 'confirmAlert');
    } else {
      // ダイアログ/小ウインドウ
      wnd.classList.add('dialogCommon');
      // ※重要※ ダイアログは固定配置＋中央化＋常に z-index 帯域をダイアログ側へ
      Object.assign(wnd.style, {
        position: 'fixed',
        inset: '0',
        margin: 'auto',
        maxWidth: 'min(95vw, 720px)',
        maxHeight: '90vh',
        width: 'fit-content',
        height: 'fit-content',
        overflow: 'auto',
        boxShadow: '0 10px 30px rgba(0,0,0,.25)'
      });
    }
    // 個別指定（集中管理しないプロパティのみ）
    // 初期 z-index 設定
    if (/^dbe-W-/.test(wndID)) {
      const z = ((window.__DBE_Z_NEXT = (window.__DBE_Z_NEXT||1000001) + 1));
      window.__DBE_Z_WINDOW_MAX = Math.max(window.__DBE_Z_WINDOW_MAX||1000000, z);
      Object.assign(wnd.style,{ zIndex:String(z), display:'none' });
    } else {
      // ダイアログ：主要ウインドウの最大より十分高く
      dbeGetWindowMaxZ();
      window.__DBE_Z_DIALOG = (window.__DBE_Z_DIALOG||0) + 100;
      const z = window.__DBE_Z_WINDOW_MAX + 1000 + window.__DBE_Z_DIALOG;
      Object.assign(wnd.style,{ zIndex:String(z), display:'none' });
    }    // クリック／タップで前面化
    try{ wnd.addEventListener('pointerdown', ()=> dbeBringToFront(wnd), {passive:true}); }catch(_){}
    // 閉じるボタン
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '×';
    Object.assign(closeBtn.style,{
      position:'sticky', float:'right', top:'0', right:'0',
      fontSize:'1.2em', margin:'0 0 6px auto', padding:'2px 10px', display:'block'
    });
    closeBtn.addEventListener('click', ()=>{
      if (wndID === 'dbe-W-Chest'){
        dbeCloseChestWindow(wnd);
        return;
      }
      wnd.style.display='none';
      // オーバーレイ処理は撤去済み
      if (wnd.dataset.dbeFronted === '1') delete wnd.dataset.dbeFronted;
    });    wnd.appendChild(closeBtn);
    document.body.appendChild(wnd);
    chestDiag('ensureWindowShell: created', wndID, 'z=', wnd.style.zIndex);
    return wnd;
  }

  // =========================
  // Z-index ユーティリティ
  // =========================
  function dbeGetWindowMaxZ(){
    try{
      const wins = document.querySelectorAll('[id^="dbe-W-"]');
      let maxZ = 1000000;
      wins.forEach(el=>{
        const cs = getComputedStyle(el);
        const z  = parseInt(cs.zIndex||'0',10);
        if (!isNaN(z)) maxZ = Math.max(maxZ, z);
      });
      // 既知の実働値と照合
      if (typeof window.__DBE_Z_WINDOW_MAX === 'number'){
        maxZ = Math.max(maxZ, window.__DBE_Z_WINDOW_MAX);
      }
      window.__DBE_Z_WINDOW_MAX = maxZ;
      return maxZ;
    }catch(_){
      return (window.__DBE_Z_WINDOW_MAX = (window.__DBE_Z_WINDOW_MAX||1000000));
    }
  }
  function dbeBringDialogToFront(wnd){
    const baseWin = dbeGetWindowMaxZ();
    // ダイアログ帯域 = 主要ウインドウ最大 + 1000 以降
    window.__DBE_Z_DIALOG = (window.__DBE_Z_DIALOG||0) + 2;
    const z = baseWin + 1000 + window.__DBE_Z_DIALOG;
    wnd.style.zIndex = String(z);
    // フロント印
    wnd.dataset.dbeFronted = '1';
    chestDiag('bringDialogToFront:', wnd.id, '→ zIndex=', z);
    return z;
  }

  function openWindowWithContent(wndID, nodes){
    const wnd = ensureWindowShell(wndID);
    // 既存の内容（閉じるボタン以外）をクリア
    Array.from(wnd.children).forEach((ch,i)=>{ if(i>0) ch.remove(); });
    // 指定ノードを追加
    const add = (n)=>{ if (n) wnd.appendChild(n); };
    if (Array.isArray(nodes)) nodes.forEach(add); else add(nodes);
    wnd.style.display = 'block';
    dbeBringToFront(wnd);
  }

  // ============================================================
  //  武器名／防具名：定義済みリストから選択してテキストボックスへ転記
  //   - kind: 'wep' / 'amr'
  //   - nameInput: 右ペインのテキストボックス（textarea）
  //   - ckAll: 「すべて」チェック（ONならOFFへ戻してから転記）
  //  ※ウィンドウIDは役割が推測できる名称に固定
  // ============================================================
  function dbeOpenNameRegistryPicker(kind, nameInput, ckAll){
    const wndID = (kind==='amr') ? 'dbe-W-ArmorNameRegistry' : 'dbe-W-WeaponNameRegistry';
    const reg   = (kind==='amr') ? armorRegistry : weaponRegistry;
    const title = (kind==='amr') ? '防具名（定義済みリスト）' : '武器名（定義済みリスト）';

    // 既存テキストボックス内容を解析してチェック状態へ反映
    // - 区切りは「;」「；」を主とし、改行/カンマ/読点も許容
    // - 完全一致（trim は許容）で照合
    const presetAll = !!(ckAll && ckAll.checked);

    // raw → parts（順序維持）をまず作り、定義済み／未定義に分配
    const parsed = (()=> {
      try{
        if (presetAll) return { parts:[], presetSet:null, undefParts:[] };
        if (!nameInput) return { parts:[], presetSet:null, undefParts:[] };
        const raw = String(nameInput.value || '');
        if (!raw.trim()) return { parts:[], presetSet:null, undefParts:[] };
        const parts = raw
          .split(/[;；,，、\n\r]+/g)
          .map(s=>String(s).trim())
          .filter(Boolean);
        if (!parts.length) return { parts:[], presetSet:null, undefParts:[] };

        // reg(Map) に存在するかどうかで振り分け（順序は入力順のまま）
        const preset = [];
        const undef  = [];
        parts.forEach((nm)=>{
          try{
            if (reg && typeof reg.has === 'function' && reg.has(nm)){
              preset.push(nm);
            } else {
              undef.push(nm);
            }
          }catch(_){
            undef.push(nm);
          }
        });

        return { parts, presetSet: new Set(preset), undefParts: undef };
      }catch(_){
        return { parts:[], presetSet:null, undefParts:[] };
      }
    })();
    const presetSet  = parsed.presetSet;
    const undefParts = parsed.undefParts || [];

    const root = document.createElement('div');
    root.className = 'dbe-namepicker';

    const head = document.createElement('div');
    head.className = 'dbe-namepicker-head';
    const h = document.createElement('div');
    h.className = 'dbe-namepicker-title';
    h.textContent = title;

    const opsTop = document.createElement('div');
    opsTop.className = 'dbe-namepicker-ops';
    const btnAll = document.createElement('button'); btnAll.type='button'; btnAll.textContent='すべて選択';
    const btnClr = document.createElement('button'); btnClr.type='button'; btnClr.textContent='すべて解除';
    opsTop.append(btnAll, btnClr);

    const list = document.createElement('div');
    list.className = 'dbe-namepicker-list';

    // 1件ずつチェックボックス化
    const items = [];
    try{
      reg.forEach((_v, key)=>{ items.push(String(key)); });
    }catch(_){}
    // 並び順は weaponRegistry / armorRegistry の「記述順序」を踏襲する
    // （Map の挿入順＝定義順を維持するため、ここでの sort は行わない）
    // （文字列順で整列させる場合は下の一行のコメントアウトを解除する）
    // items.sort((a,b)=>a.localeCompare(b,'ja'));
    const boxes = [];
    items.forEach((nm, i)=>{
      const row = document.createElement('label');
      row.className = 'dbe-namepicker-item';
      const c = document.createElement('input'); c.type='checkbox';
      // 既存入力からチェック状態を復元
      try{
        if (presetAll){
          c.checked = true;
        } else if (presetSet && presetSet.has(nm)){
          c.checked = true;
        }
      }catch(_){}
      const sp = document.createElement('span'); sp.textContent = nm;
      row.append(c, sp);
      list.appendChild(row);
      boxes.push({nm, c});
    });

    btnAll.addEventListener('click', ()=>{
      boxes.forEach(({c})=>{ c.checked = true; });
    });
    btnClr.addEventListener('click', ()=>{
      boxes.forEach(({c})=>{ c.checked = false; });
    });

    // ──────────────────────────────────────────────────────────
    // 未定義リスト（定義済みリスト風の UI：スクロール + 複数テキストボックス + 追加ボタン）
    // ──────────────────────────────────────────────────────────
    const undefTitle = document.createElement('div');
    undefTitle.className = 'dbe-namepicker-undefTitle';
    undefTitle.textContent = '未定義リスト';

    const undefList = document.createElement('div');
    undefList.className = 'dbe-namepicker-undefList';

    const addUndefRow = (value='')=>{
      const row = document.createElement('div');
      row.className = 'dbe-namepicker-undefRow';
      const ip = document.createElement('input');
      ip.type = 'text';
      ip.className = 'dbe-namepicker-undefInput';
      ip.value = String(value || '');
      ip.placeholder = '（未定義の装備名）';
      const btnDel = document.createElement('button');
      btnDel.type = 'button';
      btnDel.className = 'dbe-namepicker-undefDel';
      btnDel.textContent = '×';
      btnDel.title = 'この行を削除';
      btnDel.addEventListener('click', ()=>{
        try{
          row.remove();
          // 仕様：最低 2 つは常設（削除で不足したら補充）
          try{ ensureAtLeast(2); }catch(_){}
        }catch(_){}
      });
      row.append(ip, btnDel);
      undefList.appendChild(row);
      return ip;
    };

    const ensureAtLeast = (n)=>{
      const cur = undefList.querySelectorAll('input.dbe-namepicker-undefInput').length;
      for (let i=cur; i<n; i++){
        addUndefRow('');
      }
    };

    // 初期：未定義が見つかったらその数だけ生成（1アイテム=1ボックス）
    try{
      if (Array.isArray(undefParts) && undefParts.length){
        undefParts.forEach(v=> addUndefRow(v));
      }
    }catch(_){}
    // 仕様：最低 2 つは常設
    ensureAtLeast(2);

    const btnAddUndef = document.createElement('button');
    btnAddUndef.type = 'button';
    btnAddUndef.className = 'dbe-namepicker-undefAdd';
    btnAddUndef.textContent = '＋';
    btnAddUndef.title = 'テキストボックスを追加';
    btnAddUndef.addEventListener('click', ()=>{
      try{
        const ip = addUndefRow('');
        try{ ip.scrollIntoView({block:'nearest'}); }catch(_){}
        try{ ip.focus(); }catch(_){}
      }catch(_){}
    });
    // 追加ボタンも「未定義リスト」フィールド内に設置する
    try{ undefList.appendChild(btnAddUndef); }catch(_){}

    const getUndefValues = ()=>{
      try{
        const ips = Array.from(undefList.querySelectorAll('input.dbe-namepicker-undefInput'));
        const vals = ips
          .map(ip=>String(ip.value||'').trim())
          .filter(Boolean);
        // 重複除去（順序維持）
        const seen = new Set();
        const out = [];
        vals.forEach(v=>{
          if (!seen.has(v)){
            seen.add(v);
            out.push(v);
          }
        });
        return out;
      }catch(_){
        return [];
      }
    };

    const foot = document.createElement('div');
    foot.className = 'dbe-namepicker-foot';
    const btnPut = document.createElement('button');
    btnPut.type='button';
    btnPut.textContent='テキストボックスに転記';
    foot.append(btnPut);

    btnPut.addEventListener('click', ()=>{
      try{
        const picked = boxes.filter(({c})=>c.checked).map(({nm})=>nm);
        const undef = getUndefValues();

        // 定義済み → 未定義 の順に連結（重複は除去）
        const seen = new Set();
        const merged = [];
        picked.forEach(v=>{
          if (!seen.has(v)){
            seen.add(v);
            merged.push(v);
          }
        });
        undef.forEach(v=>{
          if (!seen.has(v)){
            seen.add(v);
            merged.push(v);
          }
        });

        // 区切りは「；」で統一（半角/全角どちらでもパーサ側で正規化される想定）
        const text = merged.join('；');

        if (ckAll && ckAll.checked){
          ckAll.checked = false;
          try{ ckAll.dispatchEvent(new Event('change', {bubbles:true})); }catch(_){}
        }
        if (nameInput){
          nameInput.value = text;
          try{ nameInput.dispatchEvent(new Event('input', {bubbles:true})); }catch(_){}
          try{ nameInput.dispatchEvent(new Event('change', {bubbles:true})); }catch(_){}
          // 追加機能：「転記」押下後にレジストリウィンドウを閉じ、元のビルダー／エディターを前面化してフォーカスを戻す
          try{
            const pickerWnd = document.getElementById(wndID);
            if (pickerWnd){
              pickerWnd.style.display = 'none';
              if (pickerWnd.dataset.dbeFronted === '1') delete pickerWnd.dataset.dbeFronted;
            }
          }catch(_){}
          try{
            // 元の UI（filtercard-builder / dbe-W-RuleEdit）を特定し、可能ならその外側の dbe-W-* を前面化
            let backBase = null;
            try{
              const inner = nameInput.closest('#filtercard-builder, #dbe-W-RuleEdit');
              backBase = inner ? (inner.closest('[id^="dbe-W-"]') || inner) : null;
            }catch(_e){ backBase = null; }
            if (backBase){
              try{
                // dbe-W-* なら通常の前面化
                if (backBase.id && backBase.id.startsWith('dbe-W-')){
                  dbeBringToFront(backBase);
                } else {
                  // 念のため（dialog等）…ただし多くの場合は上の分岐で dbe-W-* が取れる
                  dbeBringDialogToFront(backBase);
                }
              }catch(_){}
            }
          }catch(_){}
          try{ nameInput.focus(); }catch(_){}        }
      }catch(err){
        console.warn('[DBE] transfer picked names failed:', err);
      }
    });

    head.append(h, opsTop);
    // 要望：定義済みリスト と 転記ボタン の間に未定義リストを設置
    root.append(head, list, undefTitle, undefList, foot);

    // 表示（常に前面）
    openWindowWithContent(wndID, root);
  }

  // ──────────────────────────────────────────────────────────
  //  サーバーエラーダイアログ（dbe-W-Chest の枠デザイン踏襲）
  // ──────────────────────────────────────────────────────────
  function showServerErrorDialog(messageText){
    try{
      const wndID = 'dbe-Dialog-ServerError';
      const wnd = ensureWindowShell(wndID);
      // 特別な注意喚起デザイン
      wnd.classList.add('dialogAlert');
      // 外枠の角丸と余白を付与
      try{
        wnd.style.borderRadius = '10px';
        wnd.style.padding = '1em';
      }catch(_){}
      // 先頭子要素は ensureWindowShell が生成した「×」ボタン → このダイアログでは閉じ手段を「OK」のみにする
      const closeBtn = wnd.firstElementChild;
      if (closeBtn && closeBtn.tagName === 'BUTTON') {
        closeBtn.style.display = 'none';
        closeBtn.disabled = true;
      }
      // コンテンツを再構築
      Array.from(wnd.children).forEach((ch,i)=>{ if(i>0) ch.remove(); });
      const wrap = document.createElement('div');
      Object.assign(wrap.style,{display:'grid',gap:'10px',minWidth:'320px',maxWidth:'64ch'});
      // 1段目：固定ラベル
      const line1 = document.createElement('div');
      line1.textContent = 'Server Error :';
      Object.assign(line1.style,{fontWeight:'bold',fontSize:'1.05em',color:'#300'});
      // 2段目：サーバーからの実メッセージ（複数行許可）
      const line2 = document.createElement('div');
      line2.textContent = String(messageText||'').trim();
      Object.assign(line2.style,{whiteSpace:'pre-wrap',wordBreak:'break-word',lineHeight:'1.5'});
      // 3段目：「OK」ボタン
      const line3 = document.createElement('div');
      // OK ボタンを中央寄せ
      Object.assign(line3.style,{textAlign:'center'});
      const ok = document.createElement('button');
      ok.textContent = 'OK';
      Object.assign(ok.style,{display:'inline-block',padding:'6px 18px',fontSize:'1.0em',border:'2px solid #006600',borderRadius:'6px',background:'#E9FFE9',cursor:'pointer',margin:'0.5em auto'});
      ok.addEventListener('click', ()=>{ wnd.style.display = 'none'; });
      line3.appendChild(ok);
      wrap.append(line1,line2,line3);
      wnd.appendChild(wrap);
      // サーバーエラー提示時は ProgressUI 側でオーバーレイを既に解除済み。
      // ここでは新規オーバーレイを表示しない（ダイアログのみ前面に出す）。
      dbeBringDialogToFront(wnd);
      wnd.style.display = 'block';
    }catch(err){
      console.error('[DBE] showServerErrorDialog error:', err);
      alert('Server Error :\n' + String(messageText||'').trim());
    }
  }

  // ──────────────────────────────────────────────────────────
  //  宝箱/バトル宝箱：実行対象なしエラーダイアログ
  //   - 「バッグの"解錠"されている装備も選別する」OFF
  //   - 回数指定 0回
  //   → 手持ち選別も開封も行う処理が無いため、ここで停止する
  // ──────────────────────────────────────────────────────────
  function dbeShowChestNoopErrorDialog(){
    try{
      const wndID = 'dbe-Dialog-ChestNoopError';
      const wnd = ensureWindowShell(wndID);
      wnd.classList.remove('dialogCommon');
      wnd.classList.add('dialogAlert');
      Object.assign(wnd.style,{
        borderRadius:'10px',
        padding:'1em'
      });

      const closeBtn = wnd.firstElementChild;
      if (closeBtn && closeBtn.tagName === 'BUTTON') {
        closeBtn.style.display = 'none';
        closeBtn.disabled = true;
      }

      Array.from(wnd.children).forEach((ch,i)=>{ if(i>0) ch.remove(); });

      const wrap = document.createElement('div');
      Object.assign(wrap.style,{
        display:'grid',
        gap:'12px',
        minWidth:'min(84vw,320px)',
        maxWidth:'64ch',
        padding:'0.25em 0.5em'
      });

      const line1 = document.createElement('div');
      line1.textContent = 'Error:';
      Object.assign(line1.style,{
        textAlign:'left',
        fontWeight:'700',
        fontSize:'1.05em'
      });

      const line2 = document.createElement('div');
      line2.textContent = '実行する処理がありません。';
      Object.assign(line2.style,{
        textAlign:'center',
        whiteSpace:'pre-wrap',
        wordBreak:'break-word',
        lineHeight:'1.6',
        fontSize:'1.05em',
        margin:'0.25em 0'
      });

      const line3 = document.createElement('div');
      Object.assign(line3.style,{
        textAlign:'center'
      });

      const ok = document.createElement('button');
      ok.textContent = 'OK';
      Object.assign(ok.style,{
        cursor:'pointer',
        padding:'6px 20px',
        border:'2px solid #006600',
        borderRadius:'6px',
        background:'#E9FFE9',
        display:'inline-block',
        margin:'0.25em auto 0 auto'
      });
      ok.addEventListener('click', ()=>{
        wnd.style.display = 'none';
      });

      line3.appendChild(ok);
      wrap.append(line1, line2, line3);
      wnd.appendChild(wrap);

      dbeBringDialogToFront(wnd);
      wnd.style.display = 'block';
      try{ setTimeout(()=>ok.focus(), 0); }catch(_){}
    }catch(err){
      console.error('[DBE] dbeShowChestNoopErrorDialog error:', err);
      alert('Error:\n実行する処理がありません。');
    }
  }

  // ──────────────────────────────────────────────────────────
  //  サーバーエラーメッセージ抽出（iframe内ドキュメントの本文/タイトルから推定）
  //  対象：
  //   - Server Error / サーバーエラー / ng<>too fast
  //   - No room in inventory / どんぐりが見つかりませんでした。
  //   - 404 / Not Found / 403 / 300 などの一般的なHTTPエラー文言
  // ──────────────────────────────────────────────────────────
  function extractServerErrorText(doc){
    try{
      const bodyText = (doc && doc.body && doc.body.textContent) ? doc.body.textContent : '';
      const titleText = (doc && doc.title) ? String(doc.title) : '';
      const text = [titleText, bodyText].filter(Boolean).join('\n');
      if (!text) return null;

      // 代表的なキーワードを網羅（大小無視）
      const patterns = [
        /Server\s*Error/i,
        /サーバーエラー/i,
        /ng<>too\s*fast/i,
        /No\s*room\s*in\s*inventory/i,     // Left No room in inventory（前半の"Left"有無どちらも拾う）
        /Not\s*enough\s*battle\s*tokens/i, // Left Not enough battle tokens
        /Not\s*enough\s*iron\s*keys/i,     // Left Not enough iron keys.
        /どんぐりが見つかりませんでした。/i,
        /\b404\b/i, /\b403\b/i, /\b300\b/i,
        /Not\s*Found/i, /Forbidden/i, /Internal\s*Server\s*Error/i
      ];
      const hit = patterns.some(re => re.test(text));
      if (!hit) return null;

      // 表示するメッセージは本文優先で丸める
      const raw = (bodyText || titleText).trim();
      return raw.replace(/\s+\n/g,'\n').replace(/\n{3,}/g,'\n\n').slice(0, 300);
    }catch(_){
      return null;
    }
  }

  // ──────────────────────────────────────────────────────────
  //  未知のサーバーエラーメッセージ抽出（既知パターンに当てはまらない場合のフォールバック）
  //   - /bag が正規HTML（necklaceTable/weaponTable/armorTable）を含まない等の異常時に使用する想定
  //   - 文字列が空の場合は null を返す（呼び出し側で 'Unknown Error' へフォールバック）
  // ──────────────────────────────────────────────────────────
  function extractLooseErrorText(doc){
    try{
      const bodyText = (doc && doc.body && doc.body.textContent) ? doc.body.textContent : '';
      const titleText = (doc && doc.title) ? String(doc.title) : '';
      const raw = (bodyText || titleText || '').trim();
      if (!raw) return null;

      const cleaned = raw
        .replace(/\r/g,'')
        .replace(/[ \t]+\n/g,'\n')
        .replace(/\n{3,}/g,'\n\n')
        .replace(/[ \t]{2,}/g,' ')
        .trim();

      return cleaned ? cleaned.slice(0, 300) : null;
    }catch(_){
      return null;
    }
  }

  // ──────────────────────────────────────────────────────────
  //  宝箱/バトル宝箱の開封フロー用: サーバーエラー文言の正規化
  //   - バトル宝箱のトークン不足:
  //       サーバーから返る "Left Not enough battle tokens" を
  //       "Left Not enough battle tokens.\n「バトルトークン」が足りません。" に整えて表示する
  //   - 通常宝箱の鉄のキー不足:
  //       /keyshop へ転送された場合は、転送先ページ本文を表示せず、
  //       「鉄のキー」が足りない旨の固定エラーとして表示する
  // ──────────────────────────────────────────────────────────
  function normalizeChestServerErrorText(doc, loc, type){
    try{
      const url = String(loc || (doc && doc.URL) || '');
      const chestType = String(type || '');
      const isNormalChestType = (chestType === 'normal' || chestType === 'large');

      // 通常宝箱で /keyshop に転送された場合は、転送先ページを表示せず固定文言にする
      if (isNormalChestType && /\/keyshop(?:$|[?#])/.test(url)){
        return 'Left Not enough iron keys.\n「鉄のキー」が足りません。';
      }

      const raw = extractServerErrorText(doc);
      if (!raw) return null;

      // バトル宝箱で英語のバトルトークン不足エラーが返った場合は、日本語文を添えて表示する
      if (/Not\s*enough\s*battle\s*tokens/i.test(raw)){
        return 'Left Not enough battle tokens.\n「バトルトークン」が足りません。';
      }

      // 念のため、通常宝箱で英語の鉄キー不足エラーが直接返った場合も同じ表示に寄せる
      if (isNormalChestType && /Not\s*enough\s*iron\s*keys/i.test(raw)){
        return 'Left Not enough iron keys.\n「鉄のキー」が足りません。';
      }

      return raw;
    }catch(_){
      return null;
    }
  }

  // /bag が「正規のアイテムバッグHTML」かどうか（主要テーブルが存在するか）を判定
  function isValidBagHtml(doc){
    try{
      if (!doc || !doc.querySelector) return false;
      return !!doc.querySelector('#necklaceTable,#weaponTable,#armorTable');
    }catch(_){
      return false;
    }
  }

  // ──────────────────────────────────────────────────────────
  //  サーバーエラー時の共通ハンドラ（評価選別は“完全にスキップ”）
  //    - 次の開封は行わない（unlimited/left を強制停止）
  //    - lock/recycle/unlock のキューも破棄
  //    - ChestProgressUI は閉じずにエラーを表示（要件(7-a)）
  //    - アラートダイアログ表示（OKボタンのみで閉じる）
  // ──────────────────────────────────────────────────────────
  function handleServerErrorAndStopFlow(doc, messageText){
    const DBE_CHEST = (window.DBE_CHEST = window.DBE_CHEST || {});
    try{
      // (0-e) ProgressUI にもサーバーエラー内容を記録
      try{
        DBE_CHEST._serverError = true;
        const msg = String(messageText||'Server Error').trim();
        dbeAppendLog('【サーバーエラー】' + (msg ? (' ' + msg) : ''));
      }catch(_){}
      // 1) 以降の開封ループを完全停止
      DBE_CHEST.left = 0;
      DBE_CHEST.unlimited = false;
      // 2) 評価選別をスキップするため、キューを掃除
      try{
        DBE_CHEST.qLock = [];
        DBE_CHEST.qRecycle = [];
        DBE_CHEST.qUnlock = [];
      }catch(_){}
      // 3) onHold を全て消去し、onlyNew マーキング済みの行に🔰を付与（要件(7-a)）
      try{
        // onHold 解除
        document.querySelectorAll('tr.dbe-prm-Chest--onhold').forEach(tr=>tr.classList.remove('dbe-prm-Chest--onhold'));
        // onlyNew の行を検出（クラスまたは data 属性）→ 🔰 付与
        const onlyNewRows = document.querySelectorAll('tr.dbe-prm-Chest--onlynew,[data-dbe-onlynew="1"]');
        if (typeof window.DBE_setNameBadge === 'object' && window.DBE_setNameBadge){
          onlyNewRows.forEach(tr=>{
            const nameTd = Array.from(tr.cells||[]).find(td => td.querySelectorAll('span').length>=2) || tr.cells?.[0] || null;
            if (nameTd) try{ window.DBE_setNameBadge.newbie(nameTd, true); }catch(_){}
          });
        }
        // onlyNew マーキング自体は残す（🔰可視のため）。必要ならここで消す:
        // onlyNewRows.forEach(tr=>{ tr.classList.remove('dbe-prm-Chest--onlynew'); if (tr.dataset) delete tr.dataset.dbeOnlynew; });
      }catch(_){}
      // 4) 進行UIの操作状態を「停止」見た目に強制変更（中断=無効 / 閉じる=有効）＋オーバーレイ解除
      try{
        const btnAbort = document.getElementById('dbe-chestprog-abort');
        const btnClose = document.getElementById('dbe-chestprog-close');
        if (btnAbort){
          btnAbort.disabled = true;
          btnAbort.style.opacity = '0.6';
          btnAbort.style.cursor = 'default';
        }
        if (btnClose){
          btnClose.disabled = false;
          btnClose.style.opacity = '1';
          btnClose.style.cursor = 'pointer';
        }
      }catch(_){}
      // 5) ChestProgressUI は開いたままにする（終了処理は呼ばない）
      // 6) 進行用オーバーレイはここで解除（サーバーエラー時は処理停止のため）
      try{ dbeHideOverlay(); }catch(_){}
      // 6.5) ★重要★ 内部状態を完全停止（busy解除など）
      //      サーバーエラー停止後でも、ページリロード無しで再度「宝箱の自動開封」を開始できるようにする
      try{
        DBE_CHEST._autoRunning  = false;
        DBE_CHEST.didWork       = false;   // 誤って finishChest が呼ばれてもハードリロードしない
        DBE_CHEST.stage         = 'idle';
        DBE_CHEST.busy          = false;
        DBE_CHEST._lootObserved = false;   // 次回実行で lootObserver を再アタッチ可能に
        try{ dbeCancelPendingChestOpenRequest(); }catch(_){}
      }catch(_){}
      // 進行UIタイマーを止め、閉じるを有効化（ウインドウ自体は自動で閉じない）
      try{ if (typeof dbeFinishProgressUI === 'function') dbeFinishProgressUI(); }catch(_){}
      // HUD停止
      try{ if (typeof stopProgressHud === 'function') stopProgressHud(); }catch(_){}
      // ★ 自動で OFF → ON と切り替えた列表示状態を元に戻す
      try{ __dbeRestoreColsAfterRun(); }catch(_){}
    }finally{
      // 7) アラート提示（OK を押すまで閉じない。×は隠している）
      showServerErrorDialog(messageText);
    }
  }

  // ☆ 追加：OKのみの簡易ダイアログ（dbe-W-Chest の枠デザインを踏襲）
  function dbeShowOkDialog(title, message){
    try{
      const wndID = 'dbe-Dialog-Ok';
      const wnd = ensureWindowShell(wndID); // 共通殻
      wnd.classList.add('dialogCommon');    // 念のため（ensureWindowShell でも付与済み）
      // 先頭の「×」ボタンは本ダイアログでは非表示（OKのみで閉じる）
      const closeBtn = wnd.firstElementChild;
      if (closeBtn && closeBtn.tagName === 'BUTTON') {
        closeBtn.style.display = 'none';
        closeBtn.disabled = true;
      }
      // 既存の内容（閉じるボタン以外）をクリア
      Array.from(wnd.children).forEach((ch,i)=>{ if(i>0) ch.remove(); });
      // 本文
      const wrap = document.createElement('div');
      Object.assign(wrap.style,{display:'grid',gap:'10px',minWidth:'320px',maxWidth:'64ch',padding:'1em'});
      // 1行目：タイトル
      const line1 = document.createElement('div');
      line1.textContent = String(title||'');
      Object.assign(line1.style,{
        fontWeight:'300',
        fontSize:'1.3em',
        color:'#006600',
        letterSpacing:'1em',
        textAlign:'center',
        margin:'0.5em auto 0 auto'
      });
      // 2行目以降：メッセージ（3行構成に分解して余白指定）
      const msg = String(message||'').trim();
      const parts = msg.split(/\r?\n/);
      // 既定のテキストスタイル
      const baseTextStyle = { whiteSpace:'pre-wrap', wordBreak:'break-word', lineHeight:'1.25' };
      // ★ メッセージ行だけ、wrap(gap:10px)とは別のラッパーに入れて改行間隔を詰める
      const msgWrap = document.createElement('div');
      Object.assign(msgWrap.style,{ display:'grid', gap:'0px' });
      // A行（1段目のテキスト）
      const line2a = document.createElement('div');
      line2a.textContent = parts[0] ? parts[0] : '';
      Object.assign(line2a.style, baseTextStyle, { margin:'0 auto 0 0' });
      // B行（未入力項目の列挙を中央狭めで）
      const line2b = document.createElement('div');
      line2b.textContent = parts[1] ? parts[1] : '';
      Object.assign(line2b.style, baseTextStyle, { margin:'0 auto' });
      // C行（3段目のテキスト。3行目以降があればまとめて出す）
      const line2c = document.createElement('div');
      line2c.textContent = parts.length > 2 ? parts.slice(2).join('\n') : '';
      Object.assign(line2c.style, baseTextStyle, { margin:'0 auto 0 0.5em' });
      // 3行目：OKボタン
      const line3 = document.createElement('div');
      const ok = document.createElement('button');
      ok.textContent = 'OK';
      Object.assign(ok.style,{
        cursor:'pointer', padding:'6px 18px',
        border:'2px solid #006600', borderRadius:'6px', background:'#E9FFE9',
        display:'block', margin:'0.5em auto' // 中央寄せ＋指定margin
      });
      ok.addEventListener('click', ()=>{ wnd.style.display = 'none'; });
      line3.appendChild(ok);
      // メッセージの表示：分割結果に応じて追加
      wrap.append(line1);
      if (line2a.textContent) wrap.append(line2a);
      if (line2b.textContent) wrap.append(line2b);
      if (line2c.textContent) wrap.append(line2c);
      wrap.append(line3);
      wnd.appendChild(wrap);
      // ダイアログ帯域で前面化
      dbeBringDialogToFront(wnd);
      wnd.style.display = 'block';
      try{ setTimeout(()=> ok.focus(), 0); }catch(_){}
      // OK で閉じると同時にオーバーレイも畳む
      ok.addEventListener('click', ()=>{ try{ dbeHideOverlay(); }catch(_){}} , {once:true});
    }catch(err){
      console.error('[DBE] dbeShowOkDialog error:', err);
      alert(String(title||'') + (message?('\n'+String(message)):''));
    }
  }

  // ☆ 追加：赤枠の Alert ダイアログ（条件なしカードの保存禁止などに使用）
  // - タイトル「Alert:」は左寄せ
  // - 本文は中央寄せ
  // - OK ボタンは中央寄せ
  // - OK で閉じた後、focusBack があればフォーカスを戻す
  function dbeShowAlertDialog(message, focusBack, options){
    try{
      const opt = (options && typeof options === 'object') ? options : {};
      const wndID = 'dbe-Dialog-Alert';
      const wnd = ensureWindowShell(wndID); // 共通殻
      // “保存禁止”アラート専用の軽め赤枠デザイン
      wnd.classList.remove('dialogCommon','dialogAlert','dialogAlertLite');
      wnd.classList.add('dialogAlertLite');

      // 先頭の「×」ボタンは非表示（OKのみで閉じる）
      const closeBtn = wnd.firstElementChild;
      if (closeBtn && closeBtn.tagName === 'BUTTON') {
        closeBtn.style.display = 'none';
        closeBtn.disabled = true;
      }
      // 既存の内容（閉じるボタン以外）をクリア
      Array.from(wnd.children).forEach((ch,i)=>{ if(i>0) ch.remove(); });

      const wrap = document.createElement('div');
      Object.assign(wrap.style,{display:'grid',gap:'12px',minWidth:'320px',maxWidth:'64ch'});

      // タイトル（左寄せ）
      const line1 = document.createElement('div');
      line1.textContent = 'Alert:';
      Object.assign(line1.style,{
        fontWeight:'700',
        fontSize:'1.05em',
        color:'#B00000',
        textAlign:'left',
        margin:'0.5em 0.75em 0 0.75em'
      });

      // 本文（中央寄せ）
      const line2 = document.createElement('div');
      line2.textContent = String(message||'').trim();
      Object.assign(line2.style,{
        whiteSpace:'pre-wrap',
        wordBreak:'break-word',
        lineHeight:'1.6',
        textAlign:'center',
        margin:'0.25em 0.75em 0.5em 0.75em'
      });

      // OK（中央寄せ）
      const line3 = document.createElement('div');
      Object.assign(line3.style,{
        display:'flex',
        flexWrap:'wrap',
        justifyContent:'center',
        alignItems:'center',
        gap:'8px',
        margin:'0.25em auto 0.75em auto'
      });

      if (opt.reloadButton && typeof opt.reloadButton.onClick === 'function') {
        const reloadBtn = document.createElement('button');
        reloadBtn.textContent = opt.reloadButton.label || 'ページの再読み込み';
        Object.assign(reloadBtn.style,{
          cursor:'pointer',
          padding:'6px 20px',
          border:'2px solid #006600',
          borderRadius:'6px',
          background:'#E9FFE9',
          display:'inline-block',
          margin:'0'
        });
        reloadBtn.addEventListener('click', ()=>{
          try{ opt.reloadButton.onClick(); }catch(err){ console.error('[DBE] alert reloadButton failed:', err); }
        });
        line3.appendChild(reloadBtn);
      }

      const ok = document.createElement('button');
      ok.textContent = 'OK';
      Object.assign(ok.style,{
        cursor:'pointer',
        padding:'6px 20px',
        border:'2px solid #B00000',
        borderRadius:'6px',
        background:'#FFE9E9',
        display:'block',
        margin:'0.25em auto 0.75em auto'
      });
      line3.appendChild(ok);

      ok.addEventListener('click', ()=>{
        wnd.style.display = 'none';
        try{ dbeHideOverlay(); }catch(_){}
        try{
          if (focusBack && typeof focusBack.focus === 'function') focusBack.focus();
        }catch(_){}
      });

      wrap.append(line1, line2, line3);
      wnd.appendChild(wrap);
      dbeBringDialogToFront(wnd);
      wnd.style.display = 'block';
      try{ setTimeout(()=> ok.focus(), 0); }catch(_){}
    }catch(err){
      console.error('[DBE] dbeShowAlertDialog failed:', err);
      alert(String(message||''));
      try{
        if (focusBack && typeof focusBack.focus === 'function') focusBack.focus();
      }catch(_){}
    }
  }

  // ☆ 追加：二択確認ダイアログ（共通デザイン）
  // 返り値: Promise<boolean> （true=Yes/OK, false=No/Cancel）
  function dbeConfirmCommon(title, message, yesLabel, noLabel){
    return new Promise((resolve)=>{
      try{
        const wndID = 'dbe-Dialog-Confirm';
        const wnd = ensureWindowShell(wndID);
        // ×ボタンは非表示（必ず明示選択させる）
        const closeBtn = wnd.firstElementChild;
        if (closeBtn && closeBtn.tagName === 'BUTTON') {
          closeBtn.style.display = 'none';
          closeBtn.disabled = true;
        }
        // クラス（役割）を付与
        wnd.classList.remove('confirmAlert');
        wnd.classList.add('confirmCommon');
        // 既存の内容（閉じるボタン以外）をクリア
        Array.from(wnd.children).forEach((ch,i)=>{ if(i>0) ch.remove(); });
        // 本文
        const wrap = document.createElement('div');
        Object.assign(wrap.style,{display:'grid',gap:'10px',minWidth:'320px',maxWidth:'64ch'});
        // 1行目：タイトル
        const line1 = document.createElement('div');
        line1.textContent = String(title||'確認');
        line1.className = 'confirm-title';
        Object.assign(line1.style,{fontWeight:'bold',fontSize:'1.05em'});
        // 2行目：本文
        const line2 = document.createElement('div');
        line2.textContent = String(message||'').trim();
        line2.className = 'confirm-message';
        Object.assign(line2.style,{whiteSpace:'pre-wrap',wordBreak:'break-word',lineHeight:'1.5'});
        // 3行目：アクション
        const line3 = document.createElement('div');
        line3.className = 'confirm-actions';
        const yes = document.createElement('button');
        yes.textContent = String(yesLabel||'OK');
        yes.className = 'btn-yes';
        const no  = document.createElement('button');
        no.textContent = String(noLabel||'キャンセル');
        no.className = 'btn-no';
        // ボタン装飾（CSSでも当てるが、最低限の保険として）
        [yes,no].forEach(b=>Object.assign(b.style,{
          cursor:'pointer', padding:'6px 18px',
          border:'2px solid #006600', borderRadius:'6px', background:'#E9FFE9'
        }));
        // クリック挙動
        yes.addEventListener('click', ()=>{ wnd.style.display='none'; resolve(true); });
        no .addEventListener('click', ()=>{ wnd.style.display='none'; resolve(false); });
        // キー操作（Enter=yes / Esc=no）
        const onKey = (ev)=>{
          if (ev.key === 'Enter'){ ev.preventDefault(); yes.click(); }
          else if (ev.key === 'Escape'){ ev.preventDefault(); no.click(); }
        };
        wnd.addEventListener('keydown', onKey, { once:false });
        // DOM構築
        line3.append(yes,no);
        wrap.append(line1,line2,line3);
        wnd.appendChild(wrap);
        // ダイアログ帯域で前面化 → 表示 & フォーカス
        dbeBringDialogToFront(wnd);
        wnd.style.display = 'block';
        setTimeout(()=> yes.focus(), 0);
        // どちらでも閉じると同時にオーバーレイも畳む
        const hideOvOnce = ()=>{ try{ dbeHideOverlay(); }catch(_){} };
        yes.addEventListener('click', hideOvOnce, {once:true});
        no .addEventListener('click', hideOvOnce, {once:true});
      }catch(err){
        console.error('[DBE] dbeConfirmCommon error:', err);
        // フォールバック
        resolve(window.confirm(String(title||'確認') + (message?('\\n'+String(message)):'') ));
      }
    });
  }

  // ☆ 追加：二択確認ダイアログ（注意喚起デザイン）
  // 返り値: Promise<boolean> （true=Yes/OK, false=No/Cancel）
  function dbeConfirmAlert(title, message, yesLabel, noLabel){
    return new Promise((resolve)=>{
      try{
        const wndID = 'dbe-Dialog-Confirm';
        const wnd = ensureWindowShell(wndID);
        // ×ボタンは非表示
        const closeBtn = wnd.firstElementChild;
        if (closeBtn && closeBtn.tagName === 'BUTTON') {
          closeBtn.style.display = 'none';
          closeBtn.disabled = true;
        }
        // クラス（役割）を付与
        wnd.classList.remove('confirmCommon');
        wnd.classList.add('confirmAlert');
        // 既存の内容（閉じるボタン以外）をクリア
        Array.from(wnd.children).forEach((ch,i)=>{ if(i>0) ch.remove(); });
        // 本文
        const wrap = document.createElement('div');
        Object.assign(wrap.style,{display:'grid',gap:'10px',minWidth:'320px',maxWidth:'64ch'});
        // 1行目：タイトル（強調色）
        const line1 = document.createElement('div');
        line1.textContent = String(title||'確認');
        line1.className = 'confirm-title';
        Object.assign(line1.style,{fontWeight:'bold',fontSize:'1.05em',color:'#300'});
        // 2行目：本文
        const line2 = document.createElement('div');
        line2.textContent = String(message||'').trim();
        line2.className = 'confirm-message';
        Object.assign(line2.style,{whiteSpace:'pre-wrap',wordBreak:'break-word',lineHeight:'1.5'});
        // 3行目：アクション
        const line3 = document.createElement('div');
        line3.className = 'confirm-actions';
        const yes = document.createElement('button');
        yes.textContent = String(yesLabel||'はい');
        yes.className = 'btn-yes';
        const no  = document.createElement('button');
        no.textContent = String(noLabel||'いいえ');
        no.className = 'btn-no';
        // ボタン装飾（注意色）
        Object.assign(yes.style,{cursor:'pointer',padding:'6px 18px',border:'2px solid #930000',borderRadius:'6px',background:'#FFE9E9'});
        Object.assign(no .style,{cursor:'pointer',padding:'6px 18px',border:'2px solid #006600',borderRadius:'6px',background:'#E9FFE9'});
        // クリック挙動
        yes.addEventListener('click', ()=>{ wnd.style.display='none'; resolve(true); });
        no .addEventListener('click', ()=>{ wnd.style.display='none'; resolve(false); });
        // キー操作（Enter=yes / Esc=no）
        const onKey = (ev)=>{
          if (ev.key === 'Enter'){ ev.preventDefault(); yes.click(); }
          else if (ev.key === 'Escape'){ ev.preventDefault(); no.click(); }
        };
        wnd.addEventListener('keydown', onKey, { once:false });
        // DOM構築
        line3.append(yes,no);
        wrap.append(line1,line2,line3);
        wnd.appendChild(wrap);
        // ダイアログ帯域で前面化 → 表示 & フォーカス
        dbeBringDialogToFront(wnd);
        wnd.style.display = 'block';
        setTimeout(()=> yes.focus(), 0);
        // どちらでも閉じると同時にオーバーレイも畳む
        const hideOvOnce = ()=>{ try{ dbeHideOverlay(); }catch(_){} };
        yes.addEventListener('click', hideOvOnce, {once:true});
        no .addEventListener('click', hideOvOnce, {once:true});
      }catch(err){
        console.error('[DBE] dbeConfirmAlert error:', err);
        resolve(window.confirm(String(title||'確認') + (message?('\\n'+String(message)):'') ));
      }
    });
  }

  // ☆ 追加：列検出エラー時の中断ハンドラ
  function dbeAbortChest(reason){
    console.error('[DBE][ABORT] %s', reason);
    try{ dbeShowOkDialog('列検出エラー', reason + '\n処理を中断しました。'); }catch(_){}
    try{
      if (window.DBE_CHEST){
        DBE_CHEST._unlockBusy=false;
        DBE_CHEST._openBusy=false;
        DBE_CHEST._aborted=true;
        DBE_CHEST.onHoldIds && DBE_CHEST.onHoldIds.clear && DBE_CHEST.onHoldIds.clear();
      }
    }catch(_){}
    try{ window.DBE_finishChest && window.DBE_finishChest(); }catch(_){}
  }


  // 〓〓〓 旧メニューボタンID → 新メニューボタンID へ移行 〓〓〓
  //   - 旧: dbe-Menu-*（legacy） / 新: dbe-MenuBar-*
  //   - 新IDが無い場合: 旧IDをその場で新IDへ rename（id を付け替え）
  //   - 新旧が両方ある場合: 旧ID側を削除（重複防止）
  function dbeMigrateLegacyMenuIds(){
    try{
      const pairs = [
        ['dbe-Menu-navi'    , 'dbe-MenuBar-navi'],
        ['dbe-Menu-Navi'    , 'dbe-MenuBar-navi'],
        ['dbe-Menu-chest'   , 'dbe-MenuBar-chest'],
        ['dbe-Menu-recycle' , 'dbe-MenuBar-recycle'],
        ['dbe-Menu-settings', 'dbe-MenuBar-settings'],
      ];
      for (const [oldId, newId] of pairs){
        const oldEl = document.getElementById(oldId);
        const newEl = document.getElementById(newId);
        if (oldEl && !newEl){
          // 旧だけある → その場で新IDに改名
          oldEl.id = newId;
        } else if (oldEl && newEl){
          // 両方ある → 旧を削除（重複を排除）
          try{ oldEl.remove(); }catch(_){}
        }
      }
    }catch(_){}
  }

  // ============================================================
  // ▽ここから▽ メニューバー"dbe-MenuBar"と各ボタン群の生成
  // ============================================================
  function dbeNormalizeMobileLauncherPosition(pos){
    const p = String(pos || '').trim();
    switch (p){
      case 'left-top':
      case 'right-top':
      case 'left-bottom':
      case 'right-bottom':
        return p;
      default:
        return 'left-bottom';
    }
  }

  function dbeApplyMobileLauncherPosition(launcher, pos){
    try{
      const el = launcher || document.getElementById('dbe-MobileMenuLauncher');
      if (!el) return;

      const p = dbeNormalizeMobileLauncherPosition(pos || readStr('mobileLauncherPos'));
      el.dataset.dbeLauncherPosition = p;

      el.style.top = 'auto';
      el.style.right = 'auto';
      el.style.bottom = 'auto';
      el.style.left = 'auto';

      if (p.includes('left')){
        el.style.left = 'calc(env(safe-area-inset-left,0px) + 10px)';
      } else {
        el.style.right = 'calc(env(safe-area-inset-right,0px) + 10px)';
      }

      if (p.includes('top')){
        el.style.top = 'calc(env(safe-area-inset-top,0px) + 10px)';
      } else {
        el.style.bottom = 'calc(env(safe-area-inset-bottom,0px) + 10px)';
      }
    }catch(err){
      console.warn('[DBE] apply mobile launcher position failed:', err);
    }
  }

  function initDockMenu(){
    // まずレイアウト互換：旧IDが残っていても新IDへ統一
    dbeMigrateLegacyMenuIds();

    // ── 既存の状態を点検しつつ再生成/修復する堅牢化ガード ──
    const existingDock   = document.getElementById('dbe-Menu');
    let   legacyWrap     = document.getElementById('dbe-MenuBar');
    // 1) 旧ラッパがあるが display:none 等で不可視なら、ここで修復
    if (legacyWrap) {
      const cs = getComputedStyle(legacyWrap);
      if (cs && (cs.display === 'none')) {
        legacyWrap.style.display = 'contents';
      }
    }
    // 2) 旧ラッパがある & 中に dbe-Menu が居る → そのまま使う（早期復帰）
    // ※ ここで "return" せず、以降の再配線（イベント付与）処理まで通す
    // 3) 旧ラッパはあるが中身が無い → 中身だけ新規生成する
    // 4) 旧ラッパが無く、孤立した dbe-Menu が居る → ラッパを作って移設
    // 5) どちらも無ければ、両方を新規生成

    // ここから生成 / or 再利用
    const dock = existingDock || document.createElement('div');
    dock.id = 'dbe-Menu';
    Object.assign(dock.style, {
      position: 'fixed',
      gap: '2.5rem',
      pointerEvents: 'auto',
      zIndex: '1000000'
    });
    // display はCSS側で PC=flex / スマホ=none or flex を切り替える。
    // ここでインライン display:flex を持つと、スマホ用CSSの display:none が負けて
    // 初期状態からランチャーメニューが展開されてしまう。
    dock.style.removeProperty('display');

    // ボタン生成ヘルパ
    const makeBtn = (id, label)=>{
      const b = document.createElement('button');
      b.id = id;
      b.textContent = label;
      Object.assign(b.style,{
        pointerEvents:'auto',     // ← ボタンだけ受け止める
        margin:'0', padding:'0 0 5px 1px',
        width:'4rem', height:'4rem',
        boxShadow:'0 0 8px 0 rgba(51, 51, 51, 0.5)',
        border:'4px solid #006600',
        borderRadius:'8px',
        background:'#e9ffe9', color:'#ff0000',
        fontSize:'2.5rem', fontWeight:'bold',
        cursor:'pointer'
      });
      return b;
    };

    // スマホ用：常時表示する小型ランチャー
    // - PCではCSSで非表示
    // - スマホでは #dbe-Menu 本体を常時固定せず、このボタンから一時展開する
    function ensureMobileMenuLauncher(){
      let launcher = document.getElementById('dbe-MobileMenuLauncher');
      if (!launcher) {
        launcher = document.createElement('button');
        launcher.id = 'dbe-MobileMenuLauncher';
        launcher.type = 'button';
        launcher.textContent = 'DBE';
        launcher.setAttribute('aria-label', 'DBEメニューを開く');
        launcher.setAttribute('aria-expanded', 'false');
        Object.assign(launcher.style, {
          position: 'fixed',
          zIndex: '1000000',
          width: '3.4rem',
          height: '3.4rem',
          padding: '0',
          border: '4px solid #006600',
          borderRadius: '999px',
          background: '#e9ffe9',
          color: '#ff0000',
          boxShadow: '0 0 8px 0 rgba(51, 51, 51, 0.5)',
          fontSize: '1rem',
          fontWeight: 'bold',
          cursor: 'pointer',
          pointerEvents: 'auto'
        });
        document.body.appendChild(launcher);
      }
      dbeApplyMobileLauncherPosition(launcher, readStr('mobileLauncherPos'));
      if (launcher.dataset.dbeBound !== '1') {
        launcher.dataset.dbeBound = '1';
        launcher.addEventListener('click', ()=>{
          const open = !document.body.classList.contains('dbe-mobile-menu-open');
          document.body.classList.toggle('dbe-mobile-menu-open', open);
          launcher.setAttribute('aria-expanded', open ? 'true' : 'false');
          launcher.setAttribute('aria-label', open ? 'DBEメニューを閉じる' : 'DBEメニューを開く');
        });
      }
      return launcher;
    }

    // 既存/新規を問わず、ここで確実にボタン参照を用意して、無ければ生成する（新IDを優先）
    let bNavi    = dock.querySelector('#dbe-MenuBar-navi');
    let bChest   = dock.querySelector('#dbe-MenuBar-chest');
    let bRecycle = dock.querySelector('#dbe-MenuBar-recycle');
    let bSettings= dock.querySelector('#dbe-MenuBar-settings');
    if (!bNavi || !bChest || !bRecycle || !bSettings) {
      // 既存の子を一度クリア（壊れている可能性もあるため）
      while (dock.firstChild) dock.firstChild.remove();
      bNavi     = makeBtn('dbe-MenuBar-navi',     '↕️');
      bChest    = makeBtn('dbe-MenuBar-chest',    '🎁');
      bRecycle  = makeBtn('dbe-MenuBar-recycle',  '♻️');
      bSettings = makeBtn('dbe-MenuBar-settings', '⚙️');
      dock.append(bNavi, bChest, bRecycle, bSettings);
    }
    // 互換ラッパ（#dbe-MenuBar）を用意して dbe-Menu を格納
    // - ラッパ自体は display:contents の透明コンテナ
    // - 実際の配置は #dbe-Menu とスマホ用 #dbe-MobileMenuLauncher が担当
    if (!legacyWrap) {
      legacyWrap = document.createElement('div');
      legacyWrap.id = 'dbe-MenuBar';           // 旧名と互換
      legacyWrap.style.display = 'contents';   // レイアウトに干渉しない
      document.body.appendChild(legacyWrap);
    }
    // 既に別の場所にある場合は移設
    if (dock.parentElement !== legacyWrap) {
      legacyWrap.appendChild(dock);
    }
    const mobileLauncher = ensureMobileMenuLauncher();

    // 初期状態は必ず「ランチャーメニュー非表示」に揃える。
    // ※ 表示/非表示の切替は #dbe-MobileMenuLauncher の click ハンドラで行う。
    document.body.classList.remove('dbe-mobile-menu-open');
    if (mobileLauncher) {
      mobileLauncher.setAttribute('aria-expanded', 'false');
      mobileLauncher.setAttribute('aria-label', 'DBEメニューを開く');
    }

    // 〓〓〓 メニュー配置 〓〓〓
    // PC:
    //   現行どおり #dbe-Menu を固定表示
    // スマホ:
    //   #dbe-MobileMenuLauncher のみを常時固定表示し、
    //   #dbe-Menu 本体はランチャー押下時だけパネル表示する
    if (!document.getElementById('dbe-dock-style')){
      const st = document.createElement('style');
      st.id = 'dbe-dock-style';
      st.textContent = `
        /* 共通：メニュー本体 */
        #dbe-Menu{
          position: fixed;
          pointer-events: auto;
          display: flex;
          gap: 12px;
          z-index: 1000000;
        }
        #dbe-Menu > *{ pointer-events: auto; }

        /* スマホ用ランチャー：PCでは非表示 */
        #dbe-MobileMenuLauncher{
          display: none;
        }

        /* PC/タブレット横幅：現行方式を維持 */
        @media (min-width: 769px) and (orientation: portrait){
          #dbe-Menu{
            left: 0; right: 0; bottom: calc(env(safe-area-inset-bottom,0px) + 0px);
            top: auto;
            margin: 0 auto;
            flex-direction: row;
            justify-content: center;
            align-items: center;
          }
        }
        @media (min-width: 769px) and (orientation: landscape){
          #dbe-Menu{
            top: 0; bottom: 0; left: calc(env(safe-area-inset-left,0px) + 0px);
            right: auto;
            margin: auto 0;
            flex-direction: column;
            justify-content: center;
            align-items: center;
          }
        }

        /* スマホ：#dbe-Menu 本体は通常隠し、ランチャーだけ表示 */
        @media (max-width: 768px), (pointer: coarse) and (max-width: 1024px){
          #dbe-MobileMenuLauncher{
            display: inline-flex;
            align-items: center;
            justify-content: center;
            line-height: 1;
            touch-action: manipulation;
          }

          #dbe-Menu{
            display: none !important;
            left: 50%;
            right: auto;
            top: auto;
            bottom: calc(env(safe-area-inset-bottom,0px) + 72px);
            transform: translateX(-50%);
            margin: 0;
            padding: 10px;
            gap: 10px;
            flex-direction: row;
            justify-content: center;
            align-items: center;
            flex-wrap: wrap;
            max-width: min(92vw, 360px);
            background: rgba(246,255,255,0.96);
            border: 3px solid #006600;
            border-radius: 12px;
            box-shadow: 0 0 12px rgba(0,0,0,0.25);
          }

          body.dbe-mobile-menu-open #dbe-Menu{
            display: flex !important;
          }

          body.dbe-mobile-menu-open #dbe-MobileMenuLauncher{
            background: #fff9d9;
          }

          #dbe-Menu > button{
            width: 3.4rem !important;
            height: 3.4rem !important;
            font-size: 2rem !important;
            border-width: 3px !important;
            touch-action: manipulation;
          }
        }
      `;
      document.head.appendChild(st);
    }
    // ※ PC/スマホの出し分けはCSSクラスで制御する。

    // スマホ：メニュー項目を押したあとは、ランチャーパネルだけ畳む
    if (dock.dataset.dbeMobileCloseBound !== '1') {
      dock.dataset.dbeMobileCloseBound = '1';
      dock.addEventListener('click', (ev)=>{
        const btn = ev.target && ev.target.closest ? ev.target.closest('button') : null;
        if (!btn || !dock.contains(btn)) return;
        document.body.classList.remove('dbe-mobile-menu-open');
        const launcher = document.getElementById('dbe-MobileMenuLauncher');
        if (launcher) {
          launcher.setAttribute('aria-expanded', 'false');
          launcher.setAttribute('aria-label', 'DBEメニューを開く');
        }
      });
    }

    // dbe-Menu ボタンクリックのトグル動作（存在チェック付きで安全に付与）
    if (bNavi && bNavi.dataset.dbeBound !== '1') {
      bNavi.dataset.dbeBound = '1';
      bNavi.addEventListener('click', ()=>{
      const wnd = document.getElementById('dbe-W-Navi') || ensureWindowShell('dbe-W-Navi');
      if (wnd.style.display !== 'none'){
        wnd.style.display = 'none';
        if (wnd.dataset.dbeFronted === '1') delete wnd.dataset.dbeFronted;
        return;
      }
      wnd.style.display = 'inline-block';
      dbeBringToFront(wnd);
      });
    }
    // Chest：本実装ウィンドウのトグル表示
    if (bChest && bChest.dataset.dbeBound !== '1') {
      bChest.dataset.dbeBound = '1';
      bChest.addEventListener('click', ()=>{
      const wnd = document.getElementById('dbe-W-Chest') || ensureWindowShell('dbe-W-Chest');
      if (wnd.style.display !== 'none'){
        wnd.style.display = 'none';
        if (wnd.dataset.dbeFronted === '1') delete wnd.dataset.dbeFronted;
        return;
      }
      if (wnd.children.length <= 1){
        // 初回構築
          try{
            wnd.appendChild(buildChestWindow());
          } catch(err){
            console.error('[DBE] buildChestWindow error:', err);
            const msg = document.createElement('div');
            msg.textContent = 'UI の構築中にエラーが発生しました。コンソールをご確認ください。';
            msg.style.color = '#c00';
            wnd.appendChild(msg);
          }
      }
      wnd.style.display = 'inline-block';
      dbeBringToFront(wnd);
      // ▼「詳細なログを表示する」チェック UI を必ず設置/同期
      try{ dbeEnsureChestDetailLogControl(wnd); }catch(_){}
      });
    }
    if (bRecycle && bRecycle.dataset.dbeBound !== '1') {
      bRecycle.dataset.dbeBound = '1';
      bRecycle.addEventListener('click', ()=>{
      const wnd = document.getElementById('dbe-W-Recycle') || ensureWindowShell('dbe-W-Recycle');
      if (wnd.style.display !== 'none'){
        wnd.style.display = 'none';
        if (wnd.dataset.dbeFronted === '1') delete wnd.dataset.dbeFronted;
        return;
      }
      wnd.style.display = 'inline-block';
      dbeBringToFront(wnd);
      });
    }
    if (bSettings && bSettings.dataset.dbeBound !== '1') {
      bSettings.dataset.dbeBound = '1';
      bSettings.addEventListener('click', ()=>{
      const wnd = document.getElementById('dbe-W-Settings') || ensureWindowShell('dbe-W-Settings');
      if (wnd.style.display !== 'none'){
        wnd.style.display = 'none';
        if (wnd.dataset.dbeFronted === '1') delete wnd.dataset.dbeFronted;
        return;
      }
      wnd.style.display = 'inline-block';
      dbeBringToFront(wnd);
      // 開くタイミングで保存値をUIへ反映
      syncMenuFromStorage();
      });
    }
    // ============================================================
    //  △ここまで△ メニューバー"dbe-MenuBar"と各ボタン群の生成
    // ============================================================

    // ============================================================
    //  ▽ここから▽ フィルタカード Export/Import ヘルパ群
    // ============================================================

    // 形を強制整形（順序維持）
    function dbeNormalizeCardsShape(obj){
      const safeArr = v => Array.isArray(v)? v : [];
      const x = (obj && typeof obj==='object') ? obj : {};
      return { wep: safeArr(x.wep), amr: safeArr(x.amr), nec: safeArr(x.nec) };
    }
    function dbeLooksLikeRules(x){
      return !!(x && typeof x==='object'
        && Array.isArray(x.wep) && Array.isArray(x.amr) && Array.isArray(x.nec));
    }

    // ローカルストレージから候補キーを順に試す
    function dbeLoadRulesFromStorage(){
      try{
        const candidates = [
          'dbe-rules-v1',              // 本流（RULES_STORE_KEY）
          'DBE_RULES',                 // 想定キー（実装差対応）
          'DBE_RULES_EXPORT_CACHE',    // 本スクリプトのバックアップ
          'dbe_rules',
          'DonguriRules',
        ];
        for (const k of candidates){
          const raw = dbeStorage.getItem(k);
          if (!raw) continue;
          try{
            const obj = JSON.parse(raw);
            if (dbeLooksLikeRules(obj)) return obj;
            // エクスポート形式 {type:'dbe-filter-cards', data:{...}}
            if (obj && obj.type==='dbe-filter-cards' && dbeLooksLikeRules(obj.data)) return obj.data;
          }catch(_){}
        }
        // 既知キーに無ければ、全キーを総当りして wep/amr/nec を持つものを拾う
        for (let i=0;i<dbeStorage.length;i++){
          const k = dbeStorage.key(i);
          if (!k) continue;
          try{
            const obj = JSON.parse(dbeStorage.getItem(k));
            if (dbeLooksLikeRules(obj)) return obj;
            if (obj && obj.type==='dbe-filter-cards' && dbeLooksLikeRules(obj.data)) return obj.data;
          }catch(_){}
        }
      }catch(_){}
      return null;
    }
    // 現在有効なカード構造を取得（順序を保持）: 本流(_rulesData/本流ストレージ) → 互換グローバル → ストレージ候補 → 空
    function dbeGetAllFilterCards(){
      try{
        let src = null;
        // 1) 本流：スクリプト内部の _rulesData を最優先（window 側の古い/部分データに引っ張られない）
        try{
          if (typeof _rulesData === 'object' && dbeLooksLikeRules(_rulesData)) src = _rulesData;
        }catch(_){}
        // 2) 本流：本体の loadRulesFromStorage() があれば、それも試す（dbe-rules-v1 を正とする）
        if (!src){
          try{
            if (typeof loadRulesFromStorage === 'function'){
              const r = loadRulesFromStorage();
              if (dbeLooksLikeRules(r)) src = r;
            }
          }catch(_){}
        }
        // 3) 互換：グローバル → ヘルパ側ストレージ探索
        if (!src){
          src =
            (window.DBE_RULES && typeof window.DBE_RULES==='object' && dbeLooksLikeRules(window.DBE_RULES)) ? window.DBE_RULES :
            (window._rulesData && typeof window._rulesData==='object' && dbeLooksLikeRules(window._rulesData)) ? window._rulesData :
            dbeLoadRulesFromStorage();
        }
        const base = src || { wep:[], amr:[], nec:[] };
        return dbeNormalizeCardsShape(JSON.parse(JSON.stringify(base)));
      }catch(_){
        return {wep:[],amr:[],nec:[]};
      }
    }

    // 選別専用：保存済みJSONを優先してルール群のスナップショットを取得
    // - 宝箱／バトル宝箱の選別時は「その瞬間の保存済みJSON」を優先
    // - 取得失敗時のみ _rulesData へフォールバック
    function dbeGetRulesSnapshotForSelection(){
      try{
        let src = null;

        // 1) 本流ストレージ（dbe-rules-v1）を最優先
        try{
          if (typeof loadRulesFromStorage === 'function'){
            const r = loadRulesFromStorage();
            if (dbeLooksLikeRules(r)) src = r;
          }
        }catch(_){}

        // 2) 互換キー探索
        if (!src){
          try{
            const r = dbeLoadRulesFromStorage();
            if (dbeLooksLikeRules(r)) src = r;
          }catch(_){}
        }

        // 3) 最後にメモリ上の _rulesData
        if (!src){
          try{
            if (typeof _rulesData === 'object' && dbeLooksLikeRules(_rulesData)) src = _rulesData;
          }catch(_){}
        }

        const base = src || { wep:[], amr:[], nec:[] };
        return dbeNormalizeCardsShape(JSON.parse(JSON.stringify(base)));
      }catch(_){
        try{
          return dbeNormalizeCardsShape(JSON.parse(JSON.stringify(_rulesData || {wep:[],amr:[],nec:[]})));
        }catch(__){
          return {wep:[],amr:[],nec:[]};
        }
      }
    }

    // 保存：可能なら本体の保存関数(saveRulesToStorage)を使い、それが無ければ互換キーへ保存
    function dbeSaveAllFilterCards(newData){
      const data = dbeNormalizeCardsShape(newData);

      // 1) まず本流の _rulesData を更新（可能なら同一参照のまま更新して破壊的変更に追随）
      try{
        if (typeof _rulesData === 'object' && _rulesData){
          _rulesData.wep = data.wep;
          _rulesData.amr = data.amr;
          _rulesData.nec = data.nec;
        } else {
          // 参照できない場合は最小の形で置換（以降の保存で永続化）
          _rulesData = { wep:data.wep, amr:data.amr, nec:data.nec };
        }
      }catch(_){}

      // 2) 本体の saveRulesToStorage() が使えるなら最優先で永続化（= dbe-rules-v1 に保存）
      //    ★「保存しました」ダイアログは window.saveRulesToStorage のラップで発火するため、
      //      可能なら window 側を優先して呼ぶ（ローカル参照だけ先に return するとラップが走らないケースがある）
      try{
        // 互換のために window 側も同期（他所が参照していても崩れないように）
        try{ window._rulesData = _rulesData; }catch(_){}
        try{ window.DBE_RULES  = _rulesData; }catch(_){}

        let fn = null;
        if (typeof window.saveRulesToStorage === 'function'){
          fn = window.saveRulesToStorage; // ← ラップ対象なので最優先
        }else if (typeof saveRulesToStorage === 'function'){
          // window に無い環境では一応ぶら下げてから呼ぶ（後追いラップ/互換用）
          try{ window.saveRulesToStorage = saveRulesToStorage; }catch(_){}
          fn = saveRulesToStorage;
        }

        if (fn){
          const ok = fn();
          // 戻り値が true/false どちらでもない（undefined 等）実装もあるので、
          // 例外が出ていなければ基本成功扱いにする
          if (ok === false) {
            // 明示的に false を返した時だけ失敗扱いで次へ
          } else {
            return true;
          }
        }
      }catch(_){}

      // 4) フォールバック：互換キー＋本流キーにも保存（できる限りズレを無くす）
      try{
        try{ window._rulesData = _rulesData; }catch(_){}
        try{ window.DBE_RULES  = _rulesData; }catch(_){}
        // 本流キー（RULES_STORE_KEY 相当）にも保存
        try{ dbeStorage.setItem('dbe-rules-v1', JSON.stringify(_rulesData)); }catch(_){}
        // 主要キーにも保存（「上書き」時は完全置換となる）
        try{ dbeStorage.setItem('DBE_RULES', JSON.stringify(_rulesData)); }catch(_){}
        // 互換：旧/別名キーにも保存（UI 実装差吸収）
        try{ dbeStorage.setItem('dbe_rules', JSON.stringify(_rulesData)); }catch(_){}
        try{ dbeStorage.setItem('DonguriRules', JSON.stringify(_rulesData)); }catch(_){}
        // バックアップ用キーにも保存
        try{ dbeStorage.setItem('DBE_RULES_EXPORT_CACHE', JSON.stringify(_rulesData)); }catch(_){}
        return true;
      }catch(_){ return false; }
    }
    // 形を強制整形（順序維持）
    function dbeNormalizeCardsShape(obj){
      const safeArr = v => Array.isArray(v)? v : [];
      const x = (obj && typeof obj==='object') ? obj : {};
      return {
        wep: safeArr(x.wep),
        amr: safeArr(x.amr),
        nec: safeArr(x.nec)
      };
    }

    // エクスポート（JSON; 順序含め完全復元可能）— OSの保存ダイアログ使用（標準名のみ・記憶しない）
    async function dbeExportFilterCards(){
      try{
        const payload = {
          type: 'dbe-filter-cards',
          version: '1',
          exported_at: new Date().toISOString(),
          dbe_version: DBE_VERSION,
          data: dbeGetAllFilterCards()
        };

        const blob = new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'});
        const pad = n=> String(n).padStart(2,'0');
        const d = new Date();
        const name = `dbe-filter-cards_${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.json`;
        // 1) Chromium系: showSaveFilePicker で OS ダイアログ
        if (window.showSaveFilePicker){
          try{
            const handle = await window.showSaveFilePicker({
              suggestedName: name,
              types: [{ description:'JSON file', accept:{'application/json':['.json']} }]
            });
            const stream = await handle.createWritable();
            await stream.write(blob);
            await stream.close();
            return;
          }catch(err){
            // キャンセルなら静かに戻る
            if (err && err.name === 'AbortError') return;
            console.warn('[DBE] showSaveFilePicker fallback:', err);
          }
        }
        // 2) Firefox/Tampermonkey 等: GM_download(saveAs:true) で OS ダイアログ
        try{
          if (typeof GM_download === 'function'){
            const url = URL.createObjectURL(blob);
            GM_download({
              url, name, saveAs:true,
              onload:()=>URL.revokeObjectURL(url),
              ontimeout:()=>URL.revokeObjectURL(url),
              onerror:()=>URL.revokeObjectURL(url)
            });
            return;
          }
        }catch(_){}
        // 3) フォールバック：通常の自動ダウンロード（保存先はブラウザ設定依存）
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        document.body.appendChild(a);
        a.click();
        setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 50);
      }catch(err){
        console.error('[DBE] export failed:', err);
        try{ dbeShowOkDialog('エクスポート失敗','フィルタカードのエクスポートに失敗しました。'); }catch(_){}
      }
    }

    // インポート（上書き or 末尾追加）
    function dbeImportFilterCards(file, mode){ // mode: 'overwrite' | 'append'
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async ()=>{
        try{
          const raw = JSON.parse(String(reader.result||'{}'));

          // ★ 追加：エクスポート元DBEバージョンが現在より新しい場合は警告（続行/キャンセル）
          try{
            const exportedVer =
              (raw && typeof raw==='object' && raw.type==='dbe-filter-cards')
                ? (raw.dbe_version || raw.dbeVersion || raw.DBE_VERSION || raw.exported_dbe_version || null)
                : null;
            if (exportedVer && dbeCompareVersion(DBE_VERSION, exportedVer) < 0){
              const msg = [
                `このファイルは DBE v${exportedVer} でエクスポートされています。`,
                `現在ご使用の DBE は v${DBE_VERSION} のため、より古いです。`,
                'このままインポートすると、新しい項目が正しく反映されない恐れがあります。',
                'DBE を更新してからインポートすることを推奨します。',
                '',
                'このままインポートを続行しますか？'
              ].join('\n');
              const ok = await dbeConfirmAlert('警告', msg, '続行', 'キャンセル');
              if (!ok) return;
            }
          }catch(_){}

          const data = raw && raw.type==='dbe-filter-cards' && raw.data ? dbeNormalizeCardsShape(raw.data) : dbeNormalizeCardsShape(raw);
          const cur  = dbeGetAllFilterCards();
          let next;
          if (mode==='overwrite'){
            // 既存一覧を丸ごと置き換え（wep/amr/nec すべて）
            next = data;
          } else {
            // 既存一覧は保持し、末尾に追加
            next = {
              wep: [...cur.wep, ...data.wep],
              amr: [...cur.amr, ...data.amr],
              nec: [...cur.nec, ...data.nec]
            };
          }
          if (!dbeSaveAllFilterCards(next)) throw new Error('save failed');
          // ルール一覧UI（dbe-W-Rules）が開いていれば即時反映（強制再生成）
          try{
            const wnd = document.getElementById('dbe-W-Rules');
            const isOpen = wnd && getComputedStyle(wnd).display !== 'none';
            if (isOpen){
              // モーダルの DOM を一旦破棄 → 再オープンで完全再構築させる
              wnd.remove();
              // グローバルへも反映しておく（UI 側が参照する前提）
              window._rulesData = next;
              window.DBE_RULES  = next;
              // openRulesModal があれば呼び出し、無ければボタンクリックをシミュレート
              if (typeof window.openRulesModal === 'function'){
                setTimeout(()=>{ try{ window.openRulesModal(); }catch(_){} }, 0);
              } else {
                const btn = document.querySelector('#dbe-W-Chest button, #dbe-Menu button');
                setTimeout(()=>{ try{ btn && btn.click && btn.click(); }catch(_){} }, 0);
              }
            } else {
              // 閉じている場合もグローバルへ反映（次回オープン時に反映）
              window._rulesData = next;
              window.DBE_RULES  = next;
            }
          }catch(_){}
          try{ dbeShowOkDialog('インポート完了', mode==='overwrite' ? '既存一覧を上書きしました。' : '既存一覧の末尾に追加しました。'); }catch(_){}
        }catch(err){
          console.error('[DBE] import failed:', err);
          try{ dbeShowOkDialog('インポート失敗','ファイルの読み取りまたは保存に失敗しました。'); }catch(_){}
        }
      };
      reader.onerror = ()=> {
        try{ dbeShowOkDialog('インポート失敗','ファイルの読み取りに失敗しました。'); }catch(_){}
      };
      reader.readAsText(file);
    }
    // ============================================================
    // △ここまで△ フィルタカード Export/Import ヘルパ群
    // ============================================================

    // ============================================================
    // フィルタカード（選別設定）ブロック（共通部品）
    //   - 他のウィンドウ/機能からも呼び出せるように独立
    //   - 生成要素に id="filtercard" を付与
    // ============================================================
    function buildFilterCardPanel(){
      // 既に同IDが存在する場合は退避（重複IDの回避）
      try{
        const existing = document.getElementById('filtercard');
        if (existing){
          existing.id = 'filtercard--old-' + Date.now();
        }
      }catch(_){}

      const grp2 = document.createElement('div');
      grp2.id = 'filtercard';
      Object.assign(grp2.style,{
        border:'1px solid #CCC',
        borderRadius:'10px',
        padding:'8px',
        display:'grid',
        gap:'8px'
      });

      // 見出し（タイトル）
      const grp2Title = document.createElement('div');
      grp2Title.textContent = 'フィルタカードの管理';
      Object.assign(grp2Title.style,{ fontSize:'1.1em', fontWeight:'700' });

      // 注記（説明文）
      const grp2Annot = document.createElement('div');
      grp2Annot.textContent = '※ 装備をロックや分解または保留するための条件を、カード形式で設定します。';
      Object.assign(grp2Annot.style,{ fontSize:'0.9em', margin:'0', padding:'0 1em 0 3em' });

      // ボタン行
      const grp2Btns = document.createElement('div');
      Object.assign(grp2Btns.style,{
        display:'flex',
        justifyContent:'center',
        gap:'18px',
        flexWrap:'wrap'
      });

      const btnRules = document.createElement('button');
      btnRules.type = 'button'; // ← フォーム送信によるページ遷移を抑止
      // フィルタカードの作成と編集
      btnRules.textContent = 'カードの作成と編集';
      Object.assign(btnRules.style,{ borderRadius:'10px', fontSize:'0.95em', margin:'0.5em', padding:'12px 8px' });
      btnRules.addEventListener('click', (ev) => {
        try {
          if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
          if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
          openRulesModal();
        } catch (err) {
          console.error('[DBE] failed to open rules modal:', err);
        }
      });

      const btnBackup = document.createElement('button');
      btnBackup.type = 'button';
      btnBackup.textContent = 'バックアップと復元';
      Object.assign(btnBackup.style,{ borderRadius:'10px', fontSize:'0.95em', margin:'0.5em', padding:'12px 8px' });
      btnBackup.addEventListener('click', (ev) => {
        ev?.preventDefault?.();
        ev?.stopPropagation?.();
        openBackupWindow();
      });

      grp2Btns.append(btnRules, btnBackup);
      grp2.append(grp2Title, grp2Annot, grp2Btns);
      return grp2;
    }
    // ============================================================
    // △ここまで△ フィルタカード（選別設定）ブロック（共通部品）
    // ============================================================

    function dbeOpenChestDetailSettingsWindow(){
      const wnd = ensureWindowShell('dbe-W-ChestDetailSettings');
      wnd.classList.add('windowsCommon');
      Array.from(wnd.children).forEach((ch,i)=>{ if(i>0) ch.remove(); });

      const wrap = document.createElement('div');
      Object.assign(wrap.style,{
        display:'grid',
        gap:'0.8em',
        minWidth:'min(72svw,560px)'
      });

      const ttl = document.createElement('div');
      ttl.textContent = '自動開封・選別の詳細設定';
      ttl.style.cssText = 'font-size:1.15em;font-weight:700;text-align:left;';
      wrap.appendChild(ttl);

      const detailControls = [];
      const detailDefs = {
        checks: [
          { id:'dbe-prm-ChestLog--grade-Pt',   text:'プラチナ', def:true  },
          { id:'dbe-prm-ChestLog--grade-Au',   text:'金',       def:true  },
          { id:'dbe-prm-ChestLog--grade-Ag',   text:'銀',       def:true  },
          { id:'dbe-prm-ChestLog--grade-CuSn', text:'青銅',     def:false },
          { id:'dbe-prm-ChestLog--grade-Cu',   text:'銅',       def:false },
          { id:'dbe-prm-ChestLog--rarity-UR',  text:'UR',       def:true  },
          { id:'dbe-prm-ChestLog--rarity-SSR', text:'SSR',      def:true  },
          { id:'dbe-prm-ChestLog--rarity-SR',  text:'SR',       def:false },
          { id:'dbe-prm-ChestLog--rarity-R',   text:'R',        def:false },
          { id:'dbe-prm-ChestLog--rarity-N',   text:'N',        def:false }
        ],
        numbers: [
          { id:'dbe-prm-Chest--open-interval-sec',   def:'1.3', min:1.0, max:10.0, fallback:1.3 },
          { id:'dbe-prm-Chest--open-jitter-sec',     def:'0.0', min:0.0, max:10.0, fallback:0.0 },
          { id:'dbe-prm-Chest--action-interval-sec', def:'0.8', min:0.5, max:60.0, fallback:0.8 },
          { id:'dbe-prm-Chest--action-jitter-sec',   def:'0.0', min:0.0, max:60.0, fallback:0.0 }
        ]
      };

      const dbeDetailReadStored = (id, def)=>{
        try{
          const v = dbeStorage.getItem(id);
          return v === null ? def : v;
        }catch(_){
          return def;
        }
      };

      const dbeDetailReadBool = (id, def)=>{
        return dbeDetailReadStored(id, String(!!def)) === 'true';
      };

      const dbeDetailClampNumber = (el, min, max, fallback)=>{
        let v = Number(el.value);
        if (!Number.isFinite(v)) v = fallback;
        if (v < min) v = min;
        if (Number.isFinite(max) && v > max) v = max;
        el.value = v.toFixed(1);
        return el.value;
      };

      const dbeDetailFindNumberDef = (id)=>{
        return detailDefs.numbers.find(def => def.id === id) || null;
      };

      const dbeDetailSetDefaultsToInputs = ()=>{
        detailControls.forEach(ctrl=>{
          if (!ctrl || !ctrl.el) return;
          if (ctrl.type === 'checkbox'){
            ctrl.el.checked = !!ctrl.def;
            return;
          }
          if (ctrl.type === 'number'){
            ctrl.el.value = ctrl.def;
            dbeDetailClampNumber(ctrl.el, ctrl.min, ctrl.max, ctrl.fallback);
          }
        });
      };

      const dbeDetailRestoreStoredToInputs = ()=>{
        detailControls.forEach(ctrl=>{
          if (!ctrl || !ctrl.el) return;
          if (ctrl.type === 'checkbox'){
            ctrl.el.checked = dbeDetailReadBool(ctrl.id, ctrl.def);
            return;
          }
          if (ctrl.type === 'number'){
            ctrl.el.value = dbeDetailReadStored(ctrl.id, ctrl.def);
            dbeDetailClampNumber(ctrl.el, ctrl.min, ctrl.max, ctrl.fallback);
          }
        });
      };

      const dbeDetailSaveInputsToStorage = ()=>{
        detailControls.forEach(ctrl=>{
          if (!ctrl || !ctrl.el) return;
          try{
            if (ctrl.type === 'checkbox'){
              dbeStorage.setItem(ctrl.id, String(!!ctrl.el.checked));
              return;
            }
            if (ctrl.type === 'number'){
              const v = dbeDetailClampNumber(ctrl.el, ctrl.min, ctrl.max, ctrl.fallback);
              dbeStorage.setItem(ctrl.id, v);
            }
          }catch(_){}
        });
      };

      const dbeDetailCancelAndClose = ()=>{
        dbeDetailRestoreStoredToInputs();
        wnd.style.display = 'none';
        if (wnd.dataset.dbeFronted === '1') delete wnd.dataset.dbeFronted;
      };

      const closeBtn = wnd.firstElementChild;
      if (closeBtn && closeBtn.tagName === 'BUTTON' && closeBtn.dataset.dbeChestDetailCancelHooked !== '1'){
        closeBtn.dataset.dbeChestDetailCancelHooked = '1';
        closeBtn.addEventListener('click', (ev)=>{
          ev.preventDefault();
          ev.stopImmediatePropagation();
          dbeDetailCancelAndClose();
        }, true);
      }

      const logLabel = document.createElement('div');
      logLabel.textContent = '簡易ログに表示する装備';
      logLabel.style.cssText = 'margin:12px 0 0 0;padding:0;font-weight:700;text-align:left;';
      wrap.appendChild(logLabel);

      const box = document.createElement('div');
      Object.assign(box.style,{
        border:'1px solid #999',
        borderRadius:'8px',
        padding:'0.8em',
        display:'grid',
        gap:'0.55em',
        background:'#fff'
      });

      const mkCheck = (id, text, def)=>{
        const label = document.createElement('label');
        Object.assign(label.style,{
          display:'inline-flex',
          alignItems:'center',
          gap:'0.25em',
          marginRight:'1.5em',
          whiteSpace:'nowrap',
          cursor:'pointer'
        });
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.id = id;
        cb.checked = dbeDetailReadBool(id, def);
        detailControls.push({ type:'checkbox', id, el:cb, def:!!def });
        label.append(cb, document.createTextNode(text));
        return label;
      };

      const rowGrade = document.createElement('div');
      rowGrade.append(
        mkCheck('dbe-prm-ChestLog--grade-Pt',   'プラチナ', true),
        mkCheck('dbe-prm-ChestLog--grade-Au',   '金',       true),
        mkCheck('dbe-prm-ChestLog--grade-Ag',   '銀',       true),
        mkCheck('dbe-prm-ChestLog--grade-CuSn', '青銅',     false),
        mkCheck('dbe-prm-ChestLog--grade-Cu',   '銅',       false)
      );

      const rowRarity = document.createElement('div');
      rowRarity.append(
        mkCheck('dbe-prm-ChestLog--rarity-UR',  'UR',  true),
        mkCheck('dbe-prm-ChestLog--rarity-SSR', 'SSR', true),
        mkCheck('dbe-prm-ChestLog--rarity-SR',  'SR',  false),
        mkCheck('dbe-prm-ChestLog--rarity-R',   'R',   false),
        mkCheck('dbe-prm-ChestLog--rarity-N',   'N',   false)
      );

      box.append(rowGrade, rowRarity);
      wrap.appendChild(box);

      // サーバーアクセスの間隔調整
      const timingLabel = document.createElement('div');
      timingLabel.textContent = 'サーバーアクセスの間隔調整';
      timingLabel.style.cssText = 'margin:12px 0 0 0;padding:0;font-weight:700;text-align:left;';
      wrap.appendChild(timingLabel);

      const timingBox = document.createElement('div');
      Object.assign(timingBox.style,{
        border:'1px solid #999',
        borderRadius:'8px',
        padding:'0.8em',
        display:'grid',
        gap:'0.55em',
        background:'#fff',
        fontSize:'1em'
      });

      // 宝箱／バトル宝箱の開封間隔（既存機能を保持したまま移転）
      const rowTiming = document.createElement('div');
      Object.assign(rowTiming.style,{
        display:'flex',
        alignItems:'center',
        justifyContent:'flex-start',
        gap:'0.35em',
        flexWrap:'wrap',
        width:'100%'
      });

      const mkNumber = (id)=>{
        const def = dbeDetailFindNumberDef(id);
        const input = document.createElement('input');
        input.type = 'number';
        input.id = id;
        input.min = String(def.min.toFixed(1));
        input.max = String(def.max.toFixed(1));
        input.step = '0.1';
        input.value = dbeDetailReadStored(id, def.def);
        Object.assign(input.style,{width:'4.5em',padding:'2px 0 2px 8px'});
        input.addEventListener('change', ()=>dbeDetailClampNumber(input, def.min, def.max, def.fallback));
        detailControls.push({
          type:'number',
          id,
          el:input,
          def:def.def,
          min:def.min,
          max:def.max,
          fallback:def.fallback
        });
        dbeDetailClampNumber(input, def.min, def.max, def.fallback);
        return input;
      };

      const openInterval = mkNumber('dbe-prm-Chest--open-interval-sec');
      const openJitter   = mkNumber('dbe-prm-Chest--open-jitter-sec');

      rowTiming.append(
        document.createTextNode('宝箱／バトル宝箱：'),
        document.createTextNode('\u00A0\u00A0'),
        document.createTextNode('最短'),
        openInterval,
        document.createTextNode('秒 ＋ ランダム遅延'),
        openJitter,
        document.createTextNode('秒')
      );
      timingBox.appendChild(rowTiming);

      // 「/lock」「/recycle」の送信間隔
      const rowActionTiming = document.createElement('div');
      Object.assign(rowActionTiming.style,{
        display:'flex',
        alignItems:'center',
        justifyContent:'flex-start',
        gap:'0.35em',
        flexWrap:'wrap',
        width:'100%'
      });

      const actionInterval = mkNumber('dbe-prm-Chest--action-interval-sec');
      const actionJitter   = mkNumber('dbe-prm-Chest--action-jitter-sec');

      rowActionTiming.append(
        document.createTextNode('ロック／分解：'),
        document.createTextNode('\u00A0\u00A0'),
        document.createTextNode('最短'),
        actionInterval,
        document.createTextNode('秒 ＋ ランダム遅延'),
        actionJitter,
        document.createTextNode('秒')
      );
      timingBox.appendChild(rowActionTiming);
      wrap.appendChild(timingBox);

      const ops = document.createElement('div');
      Object.assign(ops.style,{
        display:'flex',
        justifyContent:'center',
        alignItems:'center',
        gap:'36px',
        flexWrap:'wrap',
        margin:'12px 0 0 0'
      });

      const btnSave = document.createElement('button');
      btnSave.type = 'button';
      btnSave.textContent = '保存する';
      Object.assign(btnSave.style,{
        padding:'8px',
        border:'2px solid #006600',
        borderRadius:'8px',
        background:'#E9FFE9',
        cursor:'pointer'
      });
      btnSave.addEventListener('click', ()=>{
        dbeDetailSaveInputsToStorage();
        wnd.style.display = 'none';
        if (wnd.dataset.dbeFronted === '1') delete wnd.dataset.dbeFronted;
      });

      const btnCancel = document.createElement('button');
      btnCancel.type = 'button';
      btnCancel.textContent = 'キャンセル';
      Object.assign(btnCancel.style,{
        padding:'8px',
        border:'2px solid #930000',
        borderRadius:'8px',
        background:'#FFE9E9',
        cursor:'pointer'
      });
      btnCancel.addEventListener('click', dbeDetailCancelAndClose);

      const btnReset = document.createElement('button');
      btnReset.type = 'button';
      btnReset.textContent = '初期化';
      Object.assign(btnReset.style,{
        padding:'8px',
        border:'2px solid #666666',
        borderRadius:'8px',
        background:'#F3F3F3',
        cursor:'pointer'
      });
      btnReset.addEventListener('click', ()=>{
        dbeDetailSetDefaultsToInputs();
      });

      ops.append(btnSave, btnCancel, btnReset);
      wrap.appendChild(ops);

      wnd.appendChild(wrap);
      wnd.style.display = 'block';
      dbeBringToFront(wnd);
    }

    function dbeIsChestRecycleUnlockedBulkEnabled(){
      const sw = document.getElementById('dbe-prm-Chest--use-recycleunlocked');
      return !!(sw && sw.dataset && sw.dataset.checked === '1');
    }

    function dbeSetChestRecycleUnlockedBulkSwitch(on){
      const sw = document.getElementById('dbe-prm-Chest--use-recycleunlocked');
      if (!sw) return;

      const enabled = !!on;
      sw.dataset.checked = enabled ? '1' : '0';
      sw.setAttribute('aria-checked', enabled ? 'true' : 'false');

      Object.assign(sw.style,{
        position:'relative',
        width:'100px',
        height:'34px',
        border:'2px solid ' + (enabled ? '#930000' : '#777777'),
        borderRadius:'999px',
        background: enabled ? '#CC0000' : '#AAAAAA',
        cursor:'pointer',
        padding:'0',
        flex:'0 0 auto',
        transition:'background 0.15s ease,border-color 0.15s ease'
      });

      const knob = sw.querySelector('.dbe-chest-recycleunlocked-knob');
      if (knob){
        Object.assign(knob.style,{
          position:'absolute',
          top:'3px',
          left: enabled ? '69px' : '3px',
          width:'24px',
          height:'24px',
          borderRadius:'50%',
          background:'#FFFFFF',
          boxShadow:'0 1px 4px rgba(0,0,0,0.35)',
          transition:'left 0.15s ease'
        });
      }

      const state = sw.querySelector('.dbe-chest-recycleunlocked-state');
      if (state){
        state.textContent = enabled ? 'ON' : 'OFF';
        Object.assign(state.style,{
          position:'absolute',
          top:'50%',
          transform:'translateY(-50%)',
          left: enabled ? '16px' : '57px',
          color:'#FFFFFF',
          fontSize:'12px',
          fontWeight:'700',
          lineHeight:'1',
          pointerEvents:'none',
          userSelect:'none'
        });
      }
    }

    function dbeOpenChestRecycleUnlockedCautionDialog(){
      try{
        const wnd = ensureWindowShell('dbe-Dialog-ChestRecycleUnlockedCaution');
        wnd.classList.remove('dialogCommon', 'dialogAlertLite');
        wnd.classList.add('dialogAlert');
        Object.assign(wnd.style,{
          borderRadius:'10px',
          padding:'1em'
        });

        const closeBtn = wnd.firstElementChild;
        if (closeBtn && closeBtn.tagName === 'BUTTON'){
          closeBtn.style.display = 'none';
          closeBtn.disabled = true;
        }

        Array.from(wnd.children).forEach((ch, i)=>{
          if (i > 0) ch.remove();
        });

        const wrap = document.createElement('div');
        Object.assign(wrap.style,{
          display:'grid',
          gap:'14px',
          minWidth:'min(86vw, 360px)',
          maxWidth:'64ch',
          padding:'0.25em 0.5em'
        });

        const title = document.createElement('div');
        title.textContent = 'Caution!';
        Object.assign(title.style,{
          textAlign:'left',
          color:'#CC0000',
          fontWeight:'700',
          fontSize:'1.1em'
        });

        const msg = document.createElement('div');
        msg.textContent = 'この機能を有効化すると、処理の高速化が期待できる代わりに、宝箱／バトル宝箱の開封とフィルタカードによる選別のとき、アイテムバッグ内でロックされていない装備（ネックレス／武器／防具）がすべて分解されます。くれぐれも分解事故にご注意ください。';
        Object.assign(msg.style,{
          textAlign:'left',
          color:'#000000',
          whiteSpace:'pre-wrap',
          wordBreak:'break-word',
          lineHeight:'1.7',
          fontSize:'1em'
        });

        const agreeLine = document.createElement('label');
        Object.assign(agreeLine.style,{
          display:'flex',
          justifyContent:'center',
          alignItems:'center',
          gap:'4px',
          userSelect:'none',
          cursor:'pointer'
        });

        const agree = document.createElement('input');
        agree.type = 'checkbox';
        agree.checked = false;

        const agreeText = document.createElement('span');
        agreeText.textContent = '了解しました。';

        agreeLine.append(agree, agreeText);

        const ops = document.createElement('div');
        Object.assign(ops.style,{
          display:'flex',
          justifyContent:'center',
          alignItems:'center',
          gap:'28px',
          flexWrap:'wrap'
        });

        const btnEnable = document.createElement('button');
        btnEnable.type = 'button';
        btnEnable.textContent = '有効化';

        const applyEnableButtonStyle = ()=>{
          const ok = !!agree.checked;
          btnEnable.disabled = !ok;
          Object.assign(btnEnable.style,{
            padding:'8px',
            border: ok ? '2px solid #006600' : '2px solid #999999',
            borderRadius:'8px',
            background: ok ? '#E9FFE9' : '#F3F3F3',
            cursor: ok ? 'pointer' : 'not-allowed',
            opacity: ok ? '1' : '0.75'
          });
        };
        applyEnableButtonStyle();

        agree.addEventListener('change', applyEnableButtonStyle);

        btnEnable.addEventListener('click', ()=>{
          if (!agree.checked) return;
          wnd.style.display = 'none';
          if (wnd.dataset.dbeFronted === '1') delete wnd.dataset.dbeFronted;
          dbeSetChestRecycleUnlockedBulkSwitch(true);
        });

        const btnCancel = document.createElement('button');
        btnCancel.type = 'button';
        btnCancel.textContent = 'キャンセル';
        Object.assign(btnCancel.style,{
          padding:'8px',
          border:'2px solid #930000',
          borderRadius:'8px',
          background:'#FFE9E9',
          cursor:'pointer'
        });
        btnCancel.addEventListener('click', ()=>{
          wnd.style.display = 'none';
          if (wnd.dataset.dbeFronted === '1') delete wnd.dataset.dbeFronted;
          dbeSetChestRecycleUnlockedBulkSwitch(false);
        });

        ops.append(btnEnable, btnCancel);
        wrap.append(title, msg, agreeLine, ops);
        wnd.appendChild(wrap);

        dbeBringDialogToFront(wnd);
        wnd.style.display = 'block';
        try{ setTimeout(()=>agree.focus(), 0); }catch(_){}
      }catch(err){
        console.error('[DBE] dbeOpenChestRecycleUnlockedCautionDialog failed:', err);
        dbeSetChestRecycleUnlockedBulkSwitch(false);
      }
    }

    function dbeCreateChestRecycleUnlockedBulkSwitchRow(){
      const row = document.createElement('div');
      Object.assign(row.style,{
        display:'flex',
        justifyContent:'center',
        alignItems:'center',
        width:'100%',
        margin:'2px 0 0 0'
      });

      const switchBlock = document.createElement('div');
      Object.assign(switchBlock.style,{
        display:'grid',
        margin:'24px 0',
        justifyItems:'center',
        alignItems:'center',
        gap:'8px',
        cursor:'default',
        userSelect:'none',
        lineHeight:'1.35',
        maxWidth:'100%',
        textAlign:'center'
      });

      const sw = document.createElement('button');
      sw.type = 'button';
      sw.id = 'dbe-prm-Chest--use-recycleunlocked';
      sw.setAttribute('role', 'switch');
      sw.setAttribute('aria-label', 'ロックされていないアイテムを全て分解する機能を使用する');

      const state = document.createElement('span');
      state.className = 'dbe-chest-recycleunlocked-state';

      const knob = document.createElement('span');
      knob.className = 'dbe-chest-recycleunlocked-knob';

      sw.append(state, knob);

      sw.addEventListener('click', (ev)=>{
        ev.preventDefault();
        ev.stopPropagation();
        if (dbeIsChestRecycleUnlockedBulkEnabled()){
          dbeSetChestRecycleUnlockedBulkSwitch(false);
        } else {
          dbeOpenChestRecycleUnlockedCautionDialog();
        }
      });

      const text = document.createElement('span');
      text.textContent = '「ロックされていないアイテムを全て分解する」機能を使用する';
      Object.assign(text.style,{
        display:'inline-block',
        maxWidth:'100%',
        textAlign:'left',
        overflowWrap:'break-word',
      });

      const textWrap = document.createElement('div');
      Object.assign(textWrap.style,{
        display:'flex',
        justifyContent:'center',
        padding:'0 4px'
      });
      textWrap.appendChild(text);

      const switchWrap = document.createElement('div');
      Object.assign(switchWrap.style,{
        display:'flex',
        justifyContent:'center',
        alignItems:'center',
        width:'100%'
      });
      switchWrap.appendChild(sw);

      switchBlock.append(textWrap, switchWrap);
      row.appendChild(switchBlock);

      // デフォルトは必ず OFF。危険機能のため localStorage 永続化はしない。
      setTimeout(()=>dbeSetChestRecycleUnlockedBulkSwitch(false), 0);

      return row;
    }

    function buildChestWindow(){
      const wrap = document.createElement('div');
      Object.assign(wrap.style,{display:'flex',flexDirection:'column',gap:'10px',minWidth:'min(70svw,560px)'});

      // ◇1段目：タイトル
      const ttl = document.createElement('div');
      ttl.textContent = '宝箱の開封とフィルタリング';
      ttl.style.fontSize = '1.15em';
      ttl.style.fontWeight = 'bold';
      wrap.appendChild(ttl);

      // ◇2段目：フィルタカード（選別設定）ブロック（共通部品）
      wrap.appendChild(buildFilterCardPanel());

      // ◇3段目：宝箱を開けてフィルタカードで選別する（枠内）
      const grp3 = document.createElement('div');
      grp3.id = 'gacha';
      Object.assign(grp3.style,{border:'1px solid #CCC', borderRadius:'10px', padding:'8px', display:'grid', gap:'6px'});
      // 1行目：テキスト
      const row3a = document.createElement('div');
      const desc = document.createElement('div');
      desc.textContent='宝箱を開けてフィルタカードで選別する';
      Object.assign(desc.style,{fontSize:'1.1em', fontWeight:'700'});
      row3a.appendChild(desc);

      // 2行目：「自動開封・選別の詳細設定」ボタン
      const rowDetail = document.createElement('div');
      Object.assign(rowDetail.style,{display:'flex',justifyContent:'center',alignItems:'center',width:'100%'});
      const btnDetail = document.createElement('button');
      btnDetail.type = 'button';
      btnDetail.id = 'dbe-btn-Chest--detail-settings';
      btnDetail.textContent = '自動開封・選別の詳細設定';
      Object.assign(btnDetail.style,{
        fontSize:'1.05em',
        margin:'4px',
        padding:'6px 8px',
        borderRadius:'8px',
        cursor:'pointer'
      });
      btnDetail.addEventListener('click', dbeOpenChestDetailSettingsWindow);
      rowDetail.appendChild(btnDetail);

      // 3行目：「ロックされていないアイテムを全て分解する」機能の使用スイッチ
      const rowRecycleUnlockedBulk = dbeCreateChestRecycleUnlockedBulkSwitchRow();

      // 4行目：回数指定/無制限 ラジオ
      const row4 = document.createElement('div');
      Object.assign(row4.style,{display:'flex',alignItems:'center',gap:'24px',flexWrap:'wrap',width:'100%',justifyContent:'center',alignItems:'flex-start'});
      const grp = 'dbe-Chest-count-group';
      // 回数指定
      const rLimited = document.createElement('input'); rLimited.type='radio'; rLimited.name=grp; rLimited.id='dbe-radio-Chest--limited';
      const nTimes   = document.createElement('input'); nTimes.type='number'; nTimes.id='dbe-prm-Chest--open-times';
      nTimes.min = '1';
      nTimes.value = '1';
      Object.assign(nTimes.style,{width:'4em', padding:'2px 0 2px 8px'});
      const partLimited = document.createElement('label'); partLimited.htmlFor = rLimited.id;
      Object.assign(partLimited.style,{display:'inline-flex',alignItems:'flex-start',gap:'2px'});
      partLimited.append(rLimited, document.createTextNode('回数指定：'));
      const spanTimes = document.createElement('span'); spanTimes.append(nTimes, document.createTextNode(' 回'));
      // 無制限
      const rUnlimited = document.createElement('input'); rUnlimited.type='radio'; rUnlimited.name=grp; rUnlimited.id='dbe-radio-Chest--unlimited';
      const partUnlimited = document.createElement('label'); partUnlimited.htmlFor = rUnlimited.id;
      partUnlimited.append(rUnlimited, document.createTextNode(' 無制限'));
      // 相互排他と有効/無効
      const syncTimes = ()=>{ nTimes.disabled = !rLimited.checked; };
      rLimited.addEventListener('change', syncTimes);
      rUnlimited.addEventListener('change', syncTimes);
      // 既定は「回数指定」＋ 初期値=1
      rLimited.checked = true;
      syncTimes();
      nTimes.addEventListener('input', ()=>{
        if (nTimes.value==='' || Number(nTimes.value) < 1) nTimes.value = '1';
      });
      row4.append(partUnlimited, partLimited);
      partLimited.appendChild(spanTimes);

      // 4行目：4ボタン（武器防具：標準/大型、ネックレス：バトル標準/大型）
      const row3b = document.createElement('div');
      const btns = document.createElement('div');
      Object.assign(btns.style,{margin:'0.5em',display:'flex',gap:'20px',flexWrap:'wrap',justifyContent:'center',alignItems:'center',width:'100%'});

      const btnNormal = document.createElement('button');
      btnNormal.id = 'dbe-btn-Chest--normal';
      btnNormal.innerHTML='宝箱<br>(武器と防具)<br>標準<br>10 鉄キー';

      const btnLarge  = document.createElement('button');
      btnLarge.id  = 'dbe-btn-Chest--large';
      btnLarge.innerHTML='宝箱<br>(武器と防具)<br>大型<br>100 鉄キー';

      const btnBattleNormal = document.createElement('button');
      btnBattleNormal.id = 'dbe-btn-Chest--battle-normal';
      btnBattleNormal.innerHTML='バトル宝箱<br>(ネックレス)<br>標準<br>10 トークン';

      const btnBattleLarge = document.createElement('button');
      btnBattleLarge.id = 'dbe-btn-Chest--battle-large';
      btnBattleLarge.innerHTML='バトル宝箱<br>(ネックレス)<br>大型<br>100 トークン';

      [btnNormal, btnLarge, btnBattleNormal, btnBattleLarge].forEach(b=>{
        b.type = 'button';
        Object.assign(b.style,{ borderRadius:'10px', fontSize:'0.8em', padding:'12px 8px' });
      });
      btns.append(btnNormal, btnLarge, btnBattleNormal, btnBattleLarge);
      row3b.append(btns);

      // 作成した各行を「宝箱を開けてフィルタカードで選別する」ブロックへ挿入する。
      // これが抜けると grp3 には枠線だけが表示され、中身が空になる。
      grp3.append(row3a, rowDetail, rowRecycleUnlockedBulk, row4, row3b);
      wrap.appendChild(grp3);

      // ◇4段目：アイテムバッグを整理する（枠内）
      const grp4 = document.createElement('div');
      grp4.id = 'sortout';
      Object.assign(grp4.style,{
        border:'1px solid #CCC',
        borderRadius:'10px',
        padding:'8px',
        display:'grid',
        gap:'8px'
      });

      const sortoutTitle = document.createElement('div');
      sortoutTitle.textContent = 'アイテムバッグを整理する';
      Object.assign(sortoutTitle.style,{fontSize:'1.1em', fontWeight:'700'});

      const sortoutDesc = document.createElement('div');
      sortoutDesc.textContent = 'アイテムバッグ内にあるロックされていない装備をフィルタカードを使用して選別します。';
      Object.assign(sortoutDesc.style,{
        fontSize:'0.95em',
        margin:'0',
        padding:'0 1em 0 3em',
        lineHeight:'1.5'
      });

      const sortoutBtns = document.createElement('div');
      Object.assign(sortoutBtns.style,{
        display:'flex',
        justifyContent:'center',
        gap:'18px',
        flexWrap:'wrap'
      });

      const btnSortWeaponArmor = document.createElement('button');
      btnSortWeaponArmor.type = 'button';
      btnSortWeaponArmor.id = 'dbe-btn-Chest--sortout-weapon-armor';
      btnSortWeaponArmor.textContent = '武器防具を整理';
      Object.assign(btnSortWeaponArmor.style,{
        borderRadius:'10px',
        fontSize:'0.95em',
        margin:'0.5em',
        padding:'12px 8px',
        cursor:'pointer'
      });
      btnSortWeaponArmor.addEventListener('click', ()=>{
        dbeSortOutUnlockedBag('weaponArmor');
      });

      const btnSortNecklace = document.createElement('button');
      btnSortNecklace.type = 'button';
      btnSortNecklace.id = 'dbe-btn-Chest--sortout-necklace';
      btnSortNecklace.textContent = 'ネックレスを整理';
      Object.assign(btnSortNecklace.style,{
        borderRadius:'10px',
        fontSize:'0.95em',
        margin:'0.5em',
        padding:'12px 8px',
        cursor:'pointer'
      });
      btnSortNecklace.addEventListener('click', ()=>{
        dbeSortOutUnlockedBag('necklace');
      });

      sortoutBtns.append(btnSortWeaponArmor, btnSortNecklace);
      grp4.append(sortoutTitle, sortoutDesc, sortoutBtns);
      wrap.appendChild(grp4);

      // ◇最下部：閉じる
      // - #dbe-W-Chest を閉じたあと、ページを再読み込みする
      const chestCloseRow = document.createElement('div');
      chestCloseRow.id = 'dbe-Chest-close-row';
      Object.assign(chestCloseRow.style,{
        display:'flex',
        justifyContent:'center',
        alignItems:'center',
        margin:'10px 0 0 0'
      });

      const btnChestClose = document.createElement('button');
      btnChestClose.type = 'button';
      btnChestClose.id = 'dbe-btn-Chest--close';
      btnChestClose.textContent = '閉じる';
      Object.assign(btnChestClose.style,{
        borderRadius:'10px',
        fontSize:'0.95em',
        margin:'0.5em',
        padding:'8px 24px',
        cursor:'pointer'
      });
      btnChestClose.addEventListener('click', ()=>{
        dbeCloseChestWindow(document.getElementById('dbe-W-Chest'));
      });

      chestCloseRow.appendChild(btnChestClose);
      wrap.appendChild(chestCloseRow);

      // ▼改修：進行UIを必ず出してから元の処理へ（ローカル参照を捕捉）
      const __DBE_local_startChestProcess = startChestProcess;
      function __DBE_prepProgressUI(type){
        try{
          const rLimited   = document.getElementById('dbe-radio-Chest--limited');
          const rUnlimited = document.getElementById('dbe-radio-Chest--unlimited');
          const nTimes     = document.getElementById('dbe-prm-Chest--open-times');
          const runCount   = Math.max(1, Number(nTimes?.value || 1));

          const DBE_CHEST  = (window.DBE_CHEST = window.DBE_CHEST || {});
          DBE_CHEST.unlimited      = !!(rUnlimited && rUnlimited.checked);
          DBE_CHEST._totalPlanned  = DBE_CHEST.unlimited ? null : runCount;
          DBE_CHEST.processed      = 0;
          DBE_CHEST._userAbort     = false;
          DBE_CHEST._serverError   = false;
          DBE_CHEST._autoRunning   = true;
          DBE_CHEST._directChestOpenBusy = false;
          // 進行UIの起動（window 公開関数経由。未定義でも安全に無視）
          if (window.DBE_StartProgressUI) { window.DBE_StartProgressUI(type); }
          else { /* オーバーレイ(dbeShowOverlay)は撤去済みのため何もしない */ }
          try{ chestDiag && chestDiag('proxy: START', type, {unlimited:DBE_CHEST.unlimited, total:DBE_CHEST._totalPlanned}); }catch(_){}
          return true;
        }catch(_){
          return false;
        }
      }
      btnNormal.addEventListener('click', ()=>{ if (!__DBE_prepProgressUI('normal')) return; const fn = (window.startChestProcess || __DBE_local_startChestProcess); if (typeof fn==='function') return fn('normal'); });
      btnLarge .addEventListener('click', ()=>{ if (!__DBE_prepProgressUI('large')) return;  const fn = (window.startChestProcess || __DBE_local_startChestProcess); if (typeof fn==='function') return fn('large');  });
      btnBattleNormal.addEventListener('click', ()=>{ if (!__DBE_prepProgressUI('battle_normal')) return; const fn = (window.startChestProcess || __DBE_local_startChestProcess); if (typeof fn==='function') return fn('battle_normal'); });
      btnBattleLarge .addEventListener('click', ()=>{ if (!__DBE_prepProgressUI('battle_large')) return;  const fn = (window.startChestProcess || __DBE_local_startChestProcess); if (typeof fn==='function') return fn('battle_large');  });

      return wrap;
    }

    // 〓〓〓 Chest 背景処理（標準／大型／バトル）→ ロック & 行ごと分解クリック 〓〓〓
    const DBE_CHEST = (window.DBE_CHEST = window.DBE_CHEST || {});
    Object.assign(DBE_CHEST, {
      busy:false,
      iframe:null,
      pre:{wep:new Set(), amr:new Set(), nec:new Set()},   // 既存ID（新規判定用）
      lastNew:{wep:new Set(), amr:new Set(), nec:new Set()}, // 直近の🔰保持（付替え用）
      qLock:[],                              // ロック用キュー [{table:'wep'|'amr', id:'123'}]
      qRecycle:[],                           // 分解用キュー（DOM の a[href*="/recycle/"] を順次 click）
      qUnlock:[],                            // 最終解除用キュー
      stage:'idle',
      type:null,                             // 'normal' | 'large' | 'battle_normal' | 'battle_large'（battle は互換）
      onlyNew:true,                          // true=新規のみ / false=バッグ内の解錠装備も選別
      recycleUnlockedBulk:false,              // true=宝箱開封選別時のみ /recycleunlocked で未ロック装備を一括分解
      onHoldIds:new Set(),                   // メインページで onhold 済ID
      delay:()=>300,                        // 待機ms（間隔±揺らぎ）
      left:1,                                // 残回数（無制限は Infinity）
      unlimited:false,
      liveDom:true,                           // ← 追加：可視DOM適用＆可視DOMでロック/分解を実行するモード
      backgroundBagTables:false,              // true=開封後の /bag 主要3テーブルを実ページへ反映しない
      didWork:false,                          // ← 追加：作業実施フラグ（ハードリロード安全弁）
      newFound:0,
      // 進行ウインドウ連携用
      processed:0,             // 処理済み回数
      _totalPlanned:null,      // 回数指定の合計（無制限は null）
      _progressTimer:null,     // 進行UI更新用タイマー
      _lootObserved:false,     // 取得結果監視の装着済みフラグ
      _userAbort:false,        // 「中断する」押下フラグ（次の実行を抑止）
      _openGateUntil:0,        // 次の開封リクエスト送信が許可される時刻（ms epoch）
      _openGateTimer:null,     // 開封待機タイマー
      _pendingOpenRequest:null // 待機後に送る開封リクエスト
    });

    function dbeClampChestOpenSec(v, min, max, fallback){
      let n = Number(v);
      if (!Number.isFinite(n)) n = fallback;
      if (n < min) n = min;
      if (n > max) n = max;
      return Math.round(n * 10) / 10;
    }

    function dbeReadChestOpenTiming(){
      const aEl = document.getElementById('dbe-prm-Chest--open-interval-sec');
      const bEl = document.getElementById('dbe-prm-Chest--open-jitter-sec');
      const readStored = (key, fallback)=>{
        try{
          const v = dbeStorage.getItem(key);
          return v === null ? fallback : v;
        }catch(_){
          return fallback;
        }
      };
      const rawA = readStored('dbe-prm-Chest--open-interval-sec', '1.3');
      const rawB = readStored('dbe-prm-Chest--open-jitter-sec', '0.0');
      const a = dbeClampChestOpenSec(rawA, 1.0, 10.0, 1.3);
      const b = dbeClampChestOpenSec(rawB, 0.0, 10.0, 0.0);
      if (aEl) aEl.value = a.toFixed(1);
      if (bEl) bEl.value = b.toFixed(1);
      return {
        intervalSec: a,
        jitterSec  : b,
        waitMs     : Math.round((a + (Math.random() * b)) * 1000)
      };
    }

    function dbeReadChestActionTiming(){
      const aEl = document.getElementById('dbe-prm-Chest--action-interval-sec');
      const bEl = document.getElementById('dbe-prm-Chest--action-jitter-sec');
      const readStored = (key, fallback)=>{
        try{
          const v = dbeStorage.getItem(key);
          return v === null ? fallback : v;
        }catch(_){
          return fallback;
        }
      };
      const rawA = readStored('dbe-prm-Chest--action-interval-sec', '0.8');
      const rawB = readStored('dbe-prm-Chest--action-jitter-sec', '0.0');
      const a = dbeClampChestOpenSec(rawA, 0.5, 60.0, 0.8);
      const b = dbeClampChestOpenSec(rawB, 0.0, 60.0, 0.0);
      if (aEl) aEl.value = a.toFixed(1);
      if (bEl) bEl.value = b.toFixed(1);
      return {
        intervalSec: a,
        jitterSec  : b,
        waitMs     : Math.round((a + (Math.random() * b)) * 1000)
      };
    }

    function dbeEnsureChestWaitModal(){
      const wnd = ensureWindowShell('dbe-Dialog-ChestWait');
      const closeBtn = wnd.firstElementChild;
      if (closeBtn && closeBtn.tagName === 'BUTTON'){
        closeBtn.style.display = 'none';
        closeBtn.disabled = true;
      }
      Array.from(wnd.children).forEach((ch, i)=>{ if (i > 0) ch.remove(); });
      const box = document.createElement('div');
      Object.assign(box.style,{
        minWidth:'18em',
        padding:'0.8em 1.2em',
        textAlign:'center',
        fontSize:'1.0em',
        fontWeight:'bold'
      });
      box.textContent = '少しお待ちください';
      wnd.appendChild(box);
      return wnd;
    }

    function dbeShowChestWaitModal(){
      const wnd = dbeEnsureChestWaitModal();
      wnd.style.display = 'block';
      dbeBringDialogToFront(wnd);
    }

    function dbeHideChestWaitModal(){
      const wnd = document.getElementById('dbe-Dialog-ChestWait');
      if (wnd) wnd.style.display = 'none';
    }

    function dbeCancelPendingChestOpenRequest(){
      try{
        clearTimeout(DBE_CHEST._openGateTimer);
        DBE_CHEST._openGateToken = (Number(DBE_CHEST._openGateToken || 0) + 1);
        DBE_CHEST._pendingOpenRequest = null;
      }catch(_){}
      dbeHideChestWaitModal();
    }

    function dbeArmChestOpenGateFromNow(){
      const timing = dbeReadChestOpenTiming();
      DBE_CHEST._openGateUntil = Date.now() + timing.waitMs;
      chestDiag('openGate armed', timing);
      return timing;
    }

    // ──────────────────────────────────────────────
    //  背景動作継続用の待機ヘルパ
    //   - 通常の setTimeout は非アクティブタブ／最小化時に強く間引かれることがある
    //   - 可能なら Worker 側の setTimeout を使い、失敗時のみ通常 setTimeout へ戻す
    //   - 完全なOSスリープ中の実行までは保証できないが、iframe load 待ちよりは止まりにくい
    // ──────────────────────────────────────────────
    function dbeChestSleep(ms){
      ms = Math.max(0, Number(ms) || 0);
      if (ms <= 0) return Promise.resolve();

      return new Promise(resolve=>{
        let done = false;
        const finish = ()=>{
          if (done) return;
          done = true;
          try{ resolve(); }catch(_){}
        };

        try{
          const DBE_CHEST = (window.DBE_CHEST = window.DBE_CHEST || {});
          if (!DBE_CHEST._timerWorker){
            const src = [
              'self.onmessage=function(ev){',
              '  var d=ev.data||{};',
              '  var id=d.id;',
              '  var ms=Math.max(0, Number(d.ms)||0);',
              '  setTimeout(function(){',
              '    try{ self.postMessage({id:id}); }catch(e){}',
              '  }, ms);',
              '};'
            ].join('');
            const blob = new Blob([src], { type:'text/javascript' });
            const url = URL.createObjectURL(blob);
            DBE_CHEST._timerWorker = new Worker(url);
            DBE_CHEST._timerWorkerUrl = url;
            DBE_CHEST._timerWaiters = new Map();
            DBE_CHEST._timerSeq = 0;
            DBE_CHEST._timerWorker.onmessage = (ev)=>{
              try{
                const id = ev && ev.data && ev.data.id;
                const cb = DBE_CHEST._timerWaiters && DBE_CHEST._timerWaiters.get(id);
                if (!cb) return;
                DBE_CHEST._timerWaiters.delete(id);
                cb();
              }catch(_){}
            };
          }

          const id = ++DBE_CHEST._timerSeq;
          DBE_CHEST._timerWaiters.set(id, finish);
          DBE_CHEST._timerWorker.postMessage({ id, ms });

          // Worker が CSP 等で動かない場合の保険。
          // Worker が先に返れば done ガードで二重 resolve しない。
          setTimeout(finish, ms + 1500);
        }catch(_){
          setTimeout(finish, ms);
        }
      });
    }

    function dbeScheduleChestOpenRequest(sendFn){
      const DBE_CHEST = (window.DBE_CHEST = window.DBE_CHEST || {});
      const token = (DBE_CHEST._openGateToken = (Number(DBE_CHEST._openGateToken || 0) + 1));

      const runWhenReady = async ()=>{
        const now = Date.now();
        const gateUntil = Number(DBE_CHEST._openGateUntil || 0);

        if (now >= gateUntil){
          const fn = DBE_CHEST._pendingOpenRequest || sendFn;
          DBE_CHEST._pendingOpenRequest = null;
          DBE_CHEST._openGateTimer = null;
          dbeHideChestWaitModal();
          if (DBE_CHEST._userAbort){
            (window.DBE_finishChest ? window.DBE_finishChest() : finishChest());
            return;
          }
          if (typeof fn === 'function'){
            dbeArmChestOpenGateFromNow();
            fn();
          }
          return;
        }

        DBE_CHEST._pendingOpenRequest = sendFn;
        dbeShowChestWaitModal();
        clearTimeout(DBE_CHEST._openGateTimer);
        // 非アクティブタブでは setTimeout が大きく遅延することがあるため、
        // 可能なら Worker timer で待ち、token でキャンセル相当の制御を行う。
        DBE_CHEST._openGateTimer = setTimeout(()=>{}, 0); // cancel API 互換用のダミー
        await dbeChestSleep(Math.max(0, gateUntil - now));
        if (token !== DBE_CHEST._openGateToken) return;
        runWhenReady();
      };

      runWhenReady();
    }

// ============================================================
    //  バックアップ管理ウインドウ（dbe-W-Backup）
    //    1段目：左＝タイトル(1.1em)、右＝閉じる
    //    2段目：左＝エクスポート、右＝注記
    //    3段目：左＝上書きインポート、右＝注記
    //    4段目：左＝追加インポート、右＝注記
    //    段間の余白は CSS 変数 --dbe-backup-row-gap で後から調整可能
// ============================================================
    function openBackupWindow(){
      const wnd = ensureWindowShell('dbe-W-Backup');
      // max-width を 表示領域の95%か860pxの小さい方に設定（ウインドウ本体）
      try{ Object.assign(wnd.style, { maxWidth: 'min(95vw, 860px)' }); }catch(_){}
      // 既存内容（×ボタン以外）をクリア
      Array.from(wnd.children).forEach((ch,i)=>{ if(i>0) ch.remove(); });
      // コンテナ（2カラム・行間は変数で調整可能）
      const box = document.createElement('div');
      Object.assign(box.style,{
        display:'grid',
        gridTemplateColumns:'11em 1fr',
        columnGap:'0.7em',
        rowGap:'var(--dbe-backup-row-gap, 20px)',
        minWidth:'min(92svw, 560px)',
        maxWidth:'min(95vw, 860px)'
      });
      // 共通：左セル/右セルを作るヘルパ
      const makeRow = ()=>[document.createElement('div'), document.createElement('div')];
      // 1段目：タイトル／閉じる
      {
        const [l,r] = makeRow();
        l.textContent = 'バックアップと復元';
        Object.assign(l.style,{fontSize:'1.1em',fontWeight:'bold',display:'flex',alignItems:'center'});
        // 右側は空（×ボタンはウインドウ標準のものを使用）
        box.append(l,r);
      }
      // 2段目：エクスポート
      {
        const [l,r] = makeRow();
        const b = document.createElement('button');
        Object.assign(l.style,{display:'flex',justifyContent:'flex-end',alignItems:'center'});
        b.textContent = 'エクスポート';
        Object.assign(b.style,{padding:'6px 12px',width:'fit-content'});
        b.addEventListener('click',()=>{ Promise.resolve(dbeExportFilterCards()); });
        l.appendChild(b);
        const t = document.createElement('div');
        t.textContent = 'フィルタカード一覧を .json 形式で書き出します。保存プロセス（保存場所の指定など）は使用ブラウザに依存します。';
        Object.assign(t.style,{opacity:0.9});
        r.appendChild(t);
        box.append(l,r);
      }
      // 3段目：追加インポート
      {
        const [l,r] = makeRow();
        Object.assign(l.style,{display:'flex',justifyContent:'flex-end',alignItems:'center'});
        const fileAP = document.createElement('input');
        fileAP.type = 'file';
        fileAP.accept = '.json,application/json';
        fileAP.style.display = 'none';
        const b = document.createElement('button');
        b.textContent = '追加インポート';
        Object.assign(b.style,{padding:'6px 12px',width:'fit-content'});
        b.addEventListener('click',()=>{ fileAP.click(); });
        fileAP.onchange = async ()=>{
          const f = fileAP.files && fileAP.files[0];
          if (f){
            const ok = await dbeConfirmCommon('確認','インポートしたカードを末尾に追加します。よろしいですか？','OK','キャンセル');
            if (ok) dbeImportFilterCards(f,'append');
          }
          fileAP.value='';
        };
        l.append(b, fileAP);
        const t = document.createElement('div');
        t.textContent = '既存のフィルタカードは維持され、その下にインポートしたカードが追加されます。';
        Object.assign(t.style,{opacity:0.9});
        r.appendChild(t);
        box.append(l,r);
      }
      // 4段目：上書きインポート
      {
        const [l,r] = makeRow();
        Object.assign(l.style,{display:'flex',justifyContent:'flex-end',alignItems:'center'});
        const fileOW = document.createElement('input');
        fileOW.type = 'file';
        fileOW.accept = '.json,application/json';
        fileOW.style.display = 'none';
        const b = document.createElement('button');
        b.textContent = '上書きインポート';
        Object.assign(b.style,{padding:'6px 12px',width:'fit-content'});
        b.addEventListener('click',()=>{ fileOW.click(); });
        fileOW.onchange = async ()=>{
          const f = fileOW.files && fileOW.files[0];
          if (f){
            const ok = await dbeConfirmAlert('警告','既存のフィルタカードをすべて破棄してインポートします。よろしいですか？','はい','いいえ');
            if (ok) dbeImportFilterCards(f,'overwrite');
          }
          fileOW.value='';
        };        l.append(b, fileOW);
        const t = document.createElement('div');
        t.textContent = '既存のフィルタカードはすべて破棄されて、インポートするカードに置き換えられます。';
        Object.assign(t.style,{opacity:0.9});
        r.appendChild(t);
        box.append(l,r);
      }
      wnd.appendChild(box);
      wnd.style.display = 'block';
    }

    function startChestProcess(kind){
      // 宝箱／バトル宝箱 4ボタン押下時の実行内容を確定する。
      // v12.1.0.0:
      // バッグ内の未ロック装備の選別は「アイテムバッグを整理する」ブロックへ独立。
      // このフローでは、宝箱／バトル宝箱で新規取得した装備のみを選別対象にする。
      const limited = document.getElementById('dbe-radio-Chest--limited')?.checked;
      const nTimes  = Math.max(1, parseInt(document.getElementById('dbe-prm-Chest--open-times')?.value||'1',10));

      if (DBE_CHEST.busy) { console.warn('[DBE] Chest already running'); return; }
      DBE_CHEST.busy = true;
      DBE_CHEST.qLock = [];
      DBE_CHEST.qRecycle = [];
      DBE_CHEST.qUnlock = [];
      DBE_CHEST.stage = 'init';
      DBE_CHEST.type  = kind;
      DBE_CHEST.didWork = true;              // ← 追加：フロー開始時に作業フラグON
      // 進行モーダルの開封回数カウント用。
      // 実際の起動経路では window.startChestProcess のラッパを通らず、
      // ローカル startChestProcess が直接呼ばれるため、ここでも必ず ON にしておく。
      DBE_CHEST._autoRunning = true;
      DBE_CHEST._serverError = false;
      DBE_CHEST._userAbort   = false;
      // ここまで
      DBE_CHEST._openGateUntil = 0;
      DBE_CHEST._pendingOpenRequest = null;
      DBE_CHEST._lootBeforeOpen = null;
      DBE_CHEST._backgroundBagSnapshotDoc = null;
      // 差分取得ログ／onlyNew監視ログの共通重複ガード
      DBE_CHEST._onlyNewLogged  = new Set();
      clearTimeout(DBE_CHEST._openGateTimer);
      DBE_CHEST._openGateTimer = null;
      dbeHideChestWaitModal();
      // ★ 処理の安定化のため、列表示を一時的に「錠/解錠＝表示」「分解＝表示」「ネックレス増減＝表示」に強制
      try{ loadRulesFromStorage(); }catch(_){}
      try{ __dbeForceShowColsForRun(); }catch(_){}
      // オプション取得
      DBE_CHEST.onlyNew = true;
      DBE_CHEST.recycleUnlockedBulk = dbeIsChestRecycleUnlockedBulkEnabled();
      DBE_CHEST.unlimited = !limited;
      DBE_CHEST.left      = limited ? nTimes : Infinity;
      DBE_CHEST.backgroundBagTables = false;
      // ★ 進捗HUD開始：ループ総数を記録し、HUDを起動（無限の場合は総数未設定）
      try{
        if (typeof startProgressHud === 'function') {
          if (Number.isFinite(DBE_CHEST.left)) DBE_CHEST.total = DBE_CHEST.left;
          startProgressHud();
        }
      }catch(_){}
      // 現在表示中の既存IDを収集
      DBE_CHEST.pre.wep = collectIdsFromMain('wep');
      DBE_CHEST.pre.amr = collectIdsFromMain('amr');
      DBE_CHEST.pre.nec = collectIdsFromMain('nec');
      // 既存の解錠装備は今回の開封選別対象から除外する。
      // 実ページ側の行へ onhold クラスは付けず、ID集合として保持するだけにする。
      DBE_CHEST.onHoldIds = collectUnlockedIdsFromMain();

      const startChestOpenAfterPreselect = ()=>{
        // v12.0.1.10:
        // ここから先の「宝箱／バトル宝箱の開封＆選別」は、iframe 内の /bag DOM だけを使う。
        // 実ページ側の necklaceTable / weaponTable / armorTable は置換・再描画しない。
        // ※ dbe-W-ChestProgress は実ページ側UIなので従来通り更新する。
        DBE_CHEST.backgroundBagTables = true;

        // v13.0.1.3:
        // 背景 iframe の src 変更＋load イベントに依存せず、
        // /chest または /battlechest を fetch で取得し、公式フォームを直接 POST する。
        // これにより、#dbe-W-Chest / #dbe-W-ChestProgress の表示状態や
        // タブ非アクティブ・ブラウザ最小化の影響で「次の開封」が止まる経路を避ける。
        dbeFetchChestPageAndOpen(kind);
      };

      startChestOpenAfterPreselect();
    }

    function ensureBgFrame(){
      if (DBE_CHEST.iframe && DBE_CHEST.iframe.isConnected) return DBE_CHEST.iframe;
      const fr = document.createElement('iframe');
      fr.id = 'dbe-bg-frame';
      Object.assign(fr.style,{position:'fixed',width:'0',height:'0',border:'0',left:'-9999px',top:'-9999px',visibility:'hidden'});
      fr.addEventListener('load', onBgFrameLoad);
      document.body.appendChild(fr);
      DBE_CHEST.iframe = fr;
      return fr;
    }

    // ──────────────────────────────────────────────────────────
    //  可視DOMパッチャ：iframe/文字列HTMLから /bag の主要テーブルを実ページへ反映
    // ──────────────────────────────────────────────────────────
    function patchBagFromDoc(srcDoc){
      try{
        const ids = ['necklaceTable','weaponTable','armorTable'];
        for (const id of ids){
          const newEl = srcDoc.getElementById(id);
          const oldEl = document.getElementById(id);
          if (newEl && oldEl){
            // クローンしてから置き換え（srcDoc のノードを生で移すと所有ドキュメントが変わる）
            oldEl.replaceWith(newEl.cloneNode(true));
          }
        }
        // ★重要：
        // patchBagFromDoc は table 要素そのものを置き換えるため、
        // initLockToggle/initRecycle が付与していた click リスナーが失われる。
        // 宝箱自動開封の終了後でも /unlock /lock /recycle のリロード抑止が効くように再配線する。
        try{ initLockToggle(); }catch(_){}
        try{ initRecycle(); }catch(_){}
        try{ applyCellColors(); }catch(_){}
      }catch(err){
        console.error('[DBE] patchBagFromDoc error:', err);
      }
    }
    function patchBagFromHTML(html){
      try{
        const doc = new DOMParser().parseFromString(html,'text/html');
        patchBagFromDoc(doc);
      }catch(err){
        console.error('[DBE] patchBagFromHTML error:', err);
      }
    }
    // /lock/:id /recycle/:id /recycleunlocked などを HTTP で実行し、返りの /bag を可視DOMへ適用
    function doActionAndApply(url){
      const needs = (re)=>typeof re==='string' && (re.includes('id="weaponTable"')||re.includes("id='weaponTable'"));
      const cred = {credentials:'include', redirect:'follow'};
      const wait = (ms)=>new Promise(r=>setTimeout(r, ms));
      const nextDelay = (typeof DBE_CHEST.delay==='function'? DBE_CHEST.delay(): 300);
      return fetch(url, cred)
        .then(r=>r.text())
        .then(html=>{
          if (!needs(html)){
            // リダイレクト等で /bag 全文になっていない場合は /bag を明示取得
            return fetch('/bag', cred).then(r=>r.text()).then(patchBagFromHTML);
          } else {
            patchBagFromHTML(html);
          }
        })
        .then(()=>wait(nextDelay))
        .catch(err=>{
          console.error('[DBE] doActionAndApply error:', err);
        });
    }

    // ──────────────────────────────────────────────────────────
    //  iframe ロードハンドラ（宝箱オープンをバックグラウンドで実行）
    // ──────────────────────────────────────────────────────────
    // ---- ID収集：各行の「装備」リンク /equip/{id} を拾う ----
    function collectRowIdsFromTable(tableId, doc){
      const root = doc || document;
      const table = root.getElementById(tableId); if (!table) return new Set();
      const body  = table.tBodies && table.tBodies[0]; if (!body) return new Set();
      const ids = new Set();
      Array.from(body.rows).forEach(row=>{
        const a = row.querySelector('a[href*="/equip/"]');
        const m = a && a.getAttribute('href').match(/\/equip\/(\d+)/);
        if (m) ids.add(m[1]);
      });
      return ids;
    }

    function clearNewbieBadgesInTable(tableId){
      const table = document.getElementById(tableId); if (!table) return;
      const body  = table.tBodies && table.tBodies[0]; if (!body) return;
      Array.from(body.rows).forEach(row=>{
        const nameTd = getNameCell(row);
        if (nameTd) window.DBE_setNameBadge.newbie(nameTd,false);
      });
    }

    function addNewbieBadgeByIds(tableId, idSet){
      const BADGE = dbeEnsureNameBadgeApi();
      const table = document.getElementById(tableId); if (!table) return;
      const body  = table.tBodies && table.tBodies[0]; if (!body) return;
      Array.from(body.rows).forEach(row=>{
        const a = row.querySelector('a[href*="/equip/"]');
        const m = a && a.getAttribute('href').match(/\/equip\/(\d+)/);
        if (!m) return;
        if (idSet.has(m[1])){
          const nameTd = getNameCell(row);
          if (nameTd) BADGE.newbie(nameTd,true);
        }
      });
    }

    function dbeMarkOnlyNewByIds(tableId, idSet){
      const table = document.getElementById(tableId); if (!table) return;
      const body  = table.tBodies && table.tBodies[0]; if (!body) return;
      Array.from(body.rows||[]).forEach(row=>{
        try{
          const a = row.querySelector('a[href*="/equip/"]');
          const m = a && a.getAttribute('href') && a.getAttribute('href').match(/\/equip\/(\d+)/);
          if (!m) return;
          const id = m[1];
          if (idSet && idSet.has(id)){
            row.classList.add('dbe-prm-Chest--onlynew');
            if (row.dataset) row.dataset.dbeOnlynew = '1';
          }
        }catch(_){}
      });
    }

    function dbeLogOnlyNewHighLootOnce(){
      try{
        const DBE_CHEST = (window.DBE_CHEST = window.DBE_CHEST || {});
        const posted = (DBE_CHEST._onlyNewLogged = DBE_CHEST._onlyNewLogged || new Set());
        const api = window.DBE_chestLootApi || {};
        const buildInfo = (typeof api.buildLogInfoFromRow === 'function') ? api.buildLogInfoFromRow : null;
        const shouldLog = (typeof api.shouldLogAction === 'function') ? api.shouldLogAction : null;
        const appendLog = (typeof api.appendLootLogEntry === 'function') ? api.appendLootLogEntry : null;
        if (!buildInfo || !shouldLog || !appendLog) return;
        const tables = ['#necklaceTable','#weaponTable','#armorTable'];
        for (const sel of tables){
          const table = document.querySelector(sel);
          if (!table || !table.tBodies || !table.tBodies[0]) continue;
          const rows = Array.from(table.tBodies[0].rows||[]);
          for (const tr of rows){
            try{
              if (!tr.classList || (!tr.classList.contains('dbe-prm-Chest--onlynew') && tr.dataset?.dbeOnlynew!=='1')) continue;
              const a = tr.querySelector('a[href*="/equip/"]');
              const m = a && a.getAttribute('href') && a.getAttribute('href').match(/\/equip\/(\d+)/);
              const id = m ? m[1] : null;
              if (!id || posted.has(id)) continue;
              const info = buildInfo(tr);
              if (!info || !shouldLog(info)) continue;
              if (info.kind === 'necklace'){
                appendLog(info);
                posted.add(id);
                continue;
              }
              if (info.kind==='weapon' || info.kind==='armor'){
                appendLog(info);
                posted.add(id);
                continue;
              }
            }catch(_){}
          }
        }
      }catch(_){}
    }

    // 直前ループでの新規セットを一括反映（武器・防具 or ネックレス）
    function updateNewbieBadgesAfterChest(kind, doc){
      // kind: 'normal'|'large'|'battle'
      const isBattleKind = (window.DBE_chestLootApi && typeof window.DBE_chestLootApi.isBattleKind === 'function')
        ? window.DBE_chestLootApi.isBattleKind(kind)
        : (kind === 'battle' || kind === 'battle_normal' || kind === 'battle_large');
      if (isBattleKind){
        // ネックレスのみ：前の🔰を全消し → 今回の新規だけ付ける
        clearNewbieBadgesInTable('necklaceTable');
        const currentIds = collectRowIdsFromTable('necklaceTable', document);
        // 直前の chest 前と比較して「増えた分」を新規とみなす
        const preSet = DBE_CHEST.pre && DBE_CHEST.pre.nec || new Set(); // 無ければ空
        const newly = new Set([...currentIds].filter(id=> !preSet.has(id)));
        DBE_CHEST.lastNew.nec = newly;
        addNewbieBadgeByIds('necklaceTable', newly);
        dbeMarkOnlyNewByIds('necklaceTable', newly);
        dbeLogOnlyNewHighLootOnce();
        return;
      }
      // 標準／大型：武器・防具
      ['weaponTable','armorTable'].forEach((tid, i)=>{
        const key = i===0 ? 'wep' : 'amr';
        clearNewbieBadgesInTable(tid);
        const currentIds = collectRowIdsFromTable(tid, document);
        const preSet = (DBE_CHEST.pre && DBE_CHEST.pre[key]) || new Set();
        const newly = new Set([...currentIds].filter(id=> !preSet.has(id)));
        DBE_CHEST.lastNew[key] = newly;
        addNewbieBadgeByIds(tid, newly);
        dbeMarkOnlyNewByIds(tid, newly);
      });
      dbeLogOnlyNewHighLootOnce();
    }

    // ──────────────────────────────────────────────────────────
    //  背景タブ/非アクティブ時でも宝箱処理を止めないための “次フレーム” ヘルパ
    //   - requestAnimationFrame は非表示タブで停止/極端に間引かれることがある
    //   - その場合は setTimeout(0) にフォールバックしてフロー継続
    // ──────────────────────────────────────────────────────────
    function dbeChestNextFrame(fn){
      try{
        const vis = (typeof document !== 'undefined' && document.visibilityState) ? document.visibilityState : 'visible';
        if (vis === 'visible' && typeof requestAnimationFrame === 'function'){
          requestAnimationFrame(fn);
        } else {
          setTimeout(fn, 0);
        }
      }catch(_){
        setTimeout(fn, 0);
      }
    }

    // ──────────────────────────────────────────────────────────
    //  fetch で返ってきたHTMLが /bag 相当かどうかを判定する
    //   - 通常宝箱: weaponTable / armorTable が返る
    //   - バトル宝箱: necklaceTable が返る
    // ──────────────────────────────────────────────────────────
    function dbeChestDocLooksLikeBag(doc){
      try{
        if (!doc || !doc.getElementById) return false;
        return !!(
          doc.getElementById('necklaceTable') ||
          doc.getElementById('weaponTable') ||
          doc.getElementById('armorTable')
        );
      }catch(_){
        return false;
      }
    }

    function dbeChestIsBattleType(type){
      const s = String(type || '');
      return (s === 'battle' || s === 'battle_normal' || s === 'battle_large');
    }

    function dbeChestPagePathForType(type){
      return dbeChestIsBattleType(type) ? '/battlechest' : '/chest';
    }

    function dbeChestWantedSizeForType(type){
      return (String(type || '') === 'large' || String(type || '') === 'battle_large') ? 'B70' : 'A65';
    }

    function dbeFindChestOpenElementInDoc(doc, type){
      try{
        if (!doc || !doc.querySelector) return null;
        const want = dbeChestWantedSizeForType(type);
        const actionPart = dbeChestIsBattleType(type) ? 'openbattlechest' : 'open';

        // 公式HTMLは通常宝箱: action="/open"、バトル宝箱: action="/openbattlechest"、
        // どちらも hidden chestsize=A65/B70 でサイズを区別している。
        const hidden = doc.querySelector(
          `form[action*="${actionPart}"] input[name="chestsize"][value="${want}"]`
        );
        const form = hidden ? hidden.closest('form') : null;
        const submit = form ? form.querySelector('input[type="submit"], button[type="submit"], button:not([type])') : null;
        if (submit) return submit;

        // フォールバック：ラベル表記から拾う。
        const normalize = (s)=>String(s || '').replace(/\s+/g, '').trim();
        const matcher = (el)=>{
          const v = normalize(el.value || el.textContent || '');
          if (dbeChestIsBattleType(type)){
            if (want === 'B70') return /大型サイズのバトル宝箱を開く/.test(v);
            return /標準サイズのバトル宝箱を開く/.test(v);
          }
          if (want === 'B70') return /大型サイズの宝箱を開ける/.test(v);
          return /標準サイズの宝箱を開ける/.test(v);
        };
        return Array.from(doc.querySelectorAll('input[type="submit"], button[type="submit"], button:not([type])')).find(matcher) || null;
      }catch(_){
        return null;
      }
    }

    async function dbeFetchChestPageAndOpen(type){
      const DBE_CHEST = (window.DBE_CHEST = window.DBE_CHEST || {});
      try{
        if (DBE_CHEST._userAbort){
          chestDiag('userAbort: stop before fetch chest page');
          (window.DBE_finishChest ? window.DBE_finishChest() : finishChest());
          return;
        }

        DBE_CHEST.stage = 'load_chest';
        const pagePath = dbeChestPagePathForType(type);
        const pageUrl = `${DBE_ORIGIN}${pagePath}`;

        chestDiag('chest page fetch:', pageUrl, 'type=', type);
        const html = await dbeChestFetchText(pagePath, {
          method: 'GET',
          cache: 'no-store',
          redirect: 'follow',
          headers: {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'X-Requested-With': 'XMLHttpRequest'
          }
        });
        const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
        const errText = normalizeChestServerErrorText(doc, pageUrl, type);
        if (errText){
          console.warn('[DBE] Server error detected while fetching chest page');
          handleServerErrorAndStopFlow(doc, errText);
          return;
        }

        const openEl = dbeFindChestOpenElementInDoc(doc, type);
        if (!openEl){
          console.warn('[DBE] chest open element not found in fetched page:', type, pageUrl);
          handleServerErrorAndStopFlow(doc, '宝箱を開けるフォームが見つかりませんでした。');
          return;
        }

        dbeScheduleChestOpenRequest(()=>{
          if (DBE_CHEST._userAbort){
            chestDiag('userAbort: stop before queued fetched open submit');
            (window.DBE_finishChest ? window.DBE_finishChest() : finishChest());
            return;
          }
          // 開封回数の加算は dbeSubmitChestOpenElement() 内へ一本化する。
          // ここで外側スコープから dbeChestBumpProcessed() を呼ぶと、
          // 関数スコープ外のため実質的に何も起きず、try/catch で握りつぶされる。
          if (!dbeSubmitChestOpenElement(openEl, pageUrl)){
            console.warn('[DBE] fetched chest open submit failed:', pageUrl);
            (window.DBE_finishChest ? window.DBE_finishChest() : finishChest());
          }
        });
      }catch(err){
        console.warn('[DBE] dbeFetchChestPageAndOpen failed:', err);
        try{
          const doc = document.implementation.createHTMLDocument('DBE chest page fetch error');
          doc.body.textContent = String(err && err.message ? err.message : err);
          handleServerErrorAndStopFlow(doc, '宝箱ページの取得に失敗しました。');
        }catch(_){
          (window.DBE_finishChest ? window.DBE_finishChest() : finishChest());
        }
      }
    }

    // ──────────────────────────────────────────────────────────
    //  開封POST後に返ってきた /bag HTML を既存の選別フローへ流し込む
    //   - iframe の load イベントに依存せず、fetch 結果の Document を直接処理する
    //   - 非アクティブタブ/別アプリ操作中でも、DOM click / form submit の不発で止まらないようにする
    // ──────────────────────────────────────────────────────────
    function dbeHandleChestReturnedBagDoc(doc, locLabel){
      const DBE_CHEST = (window.DBE_CHEST = window.DBE_CHEST || {});
      try{
        if (!doc) return false;

        const loc = String(locLabel || doc.URL || DBE_ORIGIN + '/bag');
        const chestType = DBE_CHEST.type;
        const errText = normalizeChestServerErrorText(doc, loc, chestType);
        if (errText){
          console.warn('[DBE] Server error detected during fetched chest-open flow');
          handleServerErrorAndStopFlow(doc, errText);
          return true;
        }

        if (DBE_CHEST.stage !== 'submit_chest'){
          chestDiag('fetched bag ignored: stage is not submit_chest', DBE_CHEST.stage, loc);
          return false;
        }

        // ① 返ってきた /bag を処理対象として確定
        // v12.0.1.10:
        // backgroundBagTables=true の間は、実ページ側の necklaceTable / weaponTable / armorTable を
        // 一切置換しない。選別は fetch で取得した /bag 側 doc を読み取って実行する。
        const useBackgroundBagTables = !!DBE_CHEST.backgroundBagTables;
        const targetDoc = useBackgroundBagTables ? doc : (DBE_CHEST.liveDom ? document : doc);

        // ①-A 新規取得装備の簡易ログ：
        // 「開封直前のローカル /bag HTML」と「開封後に返ってきた /bag HTML」を比較し、
        // 今回の開封で増えた行だけを #dbe-chestprog-log に上から追加する。
        // 可視DOMへ patchBagFromDoc() する前に実行することで、差分基準が崩れないようにする。
        try{ window.DBE_chestLootApi?.appendForReturnedBag?.(DBE_CHEST.type, doc); }catch(_){}

        // 読み取り（キュー構築に必要な情報はなるべくここで収集）
        // ※ buildLockQueuesAfterOpen は読む→書くが混在しやすいので、先に読む処理へ寄せられるなら寄せる
        // 書き込みは dbeChestNextFrame() でフレーム境界に回す
        dbeChestNextFrame(()=>{
          if (!useBackgroundBagTables && DBE_CHEST.liveDom){ patchBagFromDoc(doc); } // 書き込み

          // ② onhold ロック＋ ルールでロック／分解対象をキュー化
          buildLockQueuesAfterOpen(targetDoc);

          // ③ 🔰（新規）バッジの付替え
          // backgroundBagTables=true の間は、実ページ側の3テーブルを一切書き換えない。
          // 新規取得ログは appendForReturnedBag() 側で進行ウインドウへ出す。
          if (!useBackgroundBagTables){
            try{ updateNewbieBadgesAfterChest(DBE_CHEST.type, targetDoc); }catch(_){}
          }

          // ④ 以降の分岐決定も同フレーム内で行う
          if (DBE_CHEST.qLock.length>0){
            DBE_CHEST.stage = 'locking';
            scheduleNextLock();
          } else if (DBE_CHEST.recycleUnlockedBulk){
            DBE_CHEST.stage = 'recycling';
            scheduleNextRecycle();
          } else if (DBE_CHEST.qRecycle && DBE_CHEST.qRecycle.length>0){
            DBE_CHEST.stage = 'recycling';
            scheduleNextRecycle();
          } else {
            afterIterationStep(targetDoc);
          }
        });
        return true;
      }catch(err){
        console.error('[DBE] dbeHandleChestReturnedBagDoc error:', err);
        (window.DBE_finishChest && window.DBE_finishChest());
        return true;
      }
    }

    // ──────────────────────────────────────────────────────────
    //  宝箱／バトル宝箱の開封送信ヘルパ
    //   - 非アクティブタブ/別アプリ操作中に input.click() / form.submit() が不安定になるケースを避ける
    //   - 公式HTMLの form(action="/open" / "/openbattlechest") と hidden chestsize をそのまま FormData 化
    //   - fetch で直接POSTし、返ってきた /bag HTML を既存の選別処理へ渡す
    // ──────────────────────────────────────────────────────────
    function dbeSubmitChestOpenElement(openEl, locLabel){
      try{
        if (!openEl){
          console.warn('[DBE] chest open submit element is empty:', locLabel || '');
          return false;
        }
        const dbeCountChestOpenSubmit = (src, url)=>{
          try{
            const DBE_CHEST = (window.DBE_CHEST = window.DBE_CHEST || {});
            // _autoRunning が立っていない旧経路／ローカル直呼び経路でも、
            // Chest フロー中であれば「開封送信1回」としてカウントする。
            const inChestFlow =
              !!DBE_CHEST._autoRunning ||
              !!DBE_CHEST.busy ||
              DBE_CHEST.stage === 'load_chest' ||
              DBE_CHEST.stage === 'submit_chest';
            if (!inChestFlow) return;

            DBE_CHEST.processed = Number(DBE_CHEST.processed || 0) + 1;
            if (typeof window.DBE_UpdateChestCount === 'function') {
              window.DBE_UpdateChestCount();
            } else {
              const el = document.getElementById('dbe-chestprog-count');
              if (el){
                const done = Number(DBE_CHEST.processed || 0);
                if (DBE_CHEST.unlimited){
                  el.textContent = `${done} 回 / 無制限`;
                } else {
                  const tot = DBE_CHEST._totalPlanned ?? 0;
                  el.textContent = `${done} 回 / ${tot} 回`;
                }
              }
            }
            chestDiag('ChestCount(' + (src || 'open-submit') + '): +1', url || '');
          }catch(_){}
        };
        const form = (typeof openEl.closest === 'function') ? openEl.closest('form') : null;
        if (!form){
          // form が取れない異常系だけ従来 click にフォールバック
          try{
            // 開封送信として実行できた場合は、進行モーダルの分子を +1 する。
            // 通常ルートでは fetch 送信直前に加算するが、form が取れないフォールバックでは
            // click() 成功をもって「開封1回」として扱う。
            dbeCountChestOpenSubmit('open-click-fallback', locLabel || '');
            openEl.click();
            return true;
          }catch(_){}
          return false;
        }

        // submit 直前に stage を必ず進める。
        // これを行わないと、戻り先 /bag を onBgFrameLoad が「開封後」と認識できない。
        DBE_CHEST.stage = 'submit_chest';

        // 新規取得装備の簡易ログ用：
        // 開封リクエストを送る直前の、ローカル「アイテムバッグ（/bag）」HTMLを保存する。
        // このスナップショットと、開封後に返ってきた /bag HTML を比較する。
        try{ window.DBE_chestLootApi?.rememberBeforeOpen?.(DBE_CHEST.type); }catch(_){}

        // 二重送信ガード
        if (DBE_CHEST._directChestOpenBusy){
          chestDiag('chest open fetch skipped: already busy', locLabel || '');
          return true;
        }
        DBE_CHEST._directChestOpenBusy = true;

        (async ()=>{
          try{
            const action = new URL(form.getAttribute('action') || form.action || '', locLabel || location.href);
            const method = String(form.getAttribute('method') || form.method || 'POST').toUpperCase();
            const fd = new FormData(form);

            // submitter に name があるフォームでも通常送信に近い値を入れる
            try{
              const submitName = openEl.getAttribute && openEl.getAttribute('name');
              if (submitName && !fd.has(submitName)){
                fd.append(submitName, openEl.value || openEl.textContent || '');
              }
            }catch(_){}

            chestDiag('chest open fetch: POST', action.href, 'type=', DBE_CHEST.type);

            // 進行モーダルの分子（経過回数）は、実際に「宝箱／バトル宝箱を開ける」
            // POST を開始するタイミングで +1 する。
            // これにより、Progress モーダルが開いた時点で既に1回目の開封送信が行われる場合、
            // 表示は「1 回 / ...」へ更新される。
            dbeCountChestOpenSubmit('open-submit', action.href);

            const resp = await fetch(action.href, {
              method,
              body: fd,
              credentials: 'same-origin',
              redirect: 'follow',
              headers: {
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
              }
            });

            const finalUrl = resp && resp.url ? String(resp.url) : action.href;
            const html = await resp.text();
            const returnedDoc = new DOMParser().parseFromString(html || '', 'text/html');
            const errText = normalizeChestServerErrorText(returnedDoc, finalUrl, DBE_CHEST.type);
            if (errText){
              console.warn('[DBE] Server error detected during fetched chest-open flow');
              handleServerErrorAndStopFlow(returnedDoc, errText);
              return;
            }

            if (/\/bag(?:$|[?#])/.test(finalUrl) || dbeChestDocLooksLikeBag(returnedDoc)){
              dbeHandleChestReturnedBagDoc(returnedDoc, finalUrl || (DBE_ORIGIN + '/bag'));
              return;
            }

            // /keyshop など、/bag ではない応答へ遷移した場合はサーバーエラー扱いで停止
            const loose = extractLooseErrorText(returnedDoc) || `Unexpected response: ${finalUrl}`;
            console.warn('[DBE] unexpected chest-open response:', finalUrl);
            handleServerErrorAndStopFlow(returnedDoc, loose);
          }catch(err){
            console.warn('[DBE] chest open fetch failed:', err);
            try{
              const doc = document.implementation.createHTMLDocument('DBE chest fetch error');
              doc.body.textContent = String(err && err.message ? err.message : err);
              handleServerErrorAndStopFlow(doc, '通信に失敗しました。');
            }catch(_){
              (window.DBE_finishChest ? window.DBE_finishChest() : finishChest());
            }
          }finally{
            try{ DBE_CHEST._directChestOpenBusy = false; }catch(_){}
          }
        })();

        // fetch 開始には成功したので true を返す。
        // 実際の成否は async 側で処理し、成功時は dbeHandleChestReturnedBagDoc() へ進む。
        return true;
      }catch(err){
        console.warn('[DBE] dbeSubmitChestOpenElement failed:', err);
        try{ DBE_CHEST._directChestOpenBusy = false; }catch(_){}
        return false;
      }
    }

    function onBgFrameLoad(){
      const DBE_CHEST = (window.DBE_CHEST = window.DBE_CHEST || {});
      try{
        console.assert(typeof scheduleNextLock === 'function', '[DBE] scheduleNextLock is not a function');
        const fr = DBE_CHEST.iframe;
        if (!fr || !fr.contentDocument) return;
        const doc = fr.contentDocument;
        const loc = fr.contentWindow.location.href;
        const chestType = DBE_CHEST.type;
        // URL種別（誤検知防止のため先に判定）
        const isBag   = /\/bag(?:$|[?#])/.test(loc);
        const isChest = /\/(?:battlechest|chest)(?:$|[?#])/.test(loc);
        // ステージごとの処理
        if (DBE_CHEST.stage === 'load_chest'){
          // 背景ページの送信ボタンをクリック
          // ページ実体は「バトル宝箱を開く  」等となっており、末尾スペースや表記ゆれを吸収する
          const type = chestType;
          const val = (s)=> (s||'').replace(/\s+/g,'').trim();
          // 種別ごとの候補（正規表現／文字列の両方で吸収）
          const matcher = (el)=>{
            const v = val(el.value);
            if (type==='battle')        return /標準サイズのバトル宝箱を開く/.test(v); // 互換：旧battleは標準扱い
            if (type==='battle_normal') return /標準サイズのバトル宝箱を開く/.test(v);
            if (type==='battle_large')  return /大型サイズのバトル宝箱を開く/.test(v);
            if (type==='normal')        return /標準サイズの宝箱を開ける/.test(v);
            /* large */                 return /大型サイズの宝箱を開ける/.test(v);
          };
          // まず input[type=submit] を走査、見つからなければ form[action*="battlechest"] 直下の submit を拾う
          let btn = Array.from(doc.querySelectorAll('input[type="submit"]')).find(matcher);
          const isBattleType = (t)=> (t==='battle' || t==='battle_normal' || t==='battle_large');
          if (!btn && isBattleType(type)){
            // フォールバック：hidden chestsize から form を特定して submit を拾う（標準=A65 / 大型=B70）
            const want = (type==='battle_large') ? 'B70' : 'A65';
            const hidden = doc.querySelector(`form[action*="openbattlechest"] input[name="chestsize"][value="${want}"], form[action*="battlechest"] input[name="chestsize"][value="${want}"]`);
            const form = hidden ? hidden.closest('form') : null;
            btn = form ? (form.querySelector('input[type="submit"], button[type="submit"]')) : null;
          }
          if (!btn){
            // 送信ボタンが見つからない場合のみサーバーエラー推定を実施
            const errText = !isChest ? normalizeChestServerErrorText(doc, loc, chestType) : null;
            if (errText){
              console.warn('[DBE] Server error detected during chest-open flow');
              handleServerErrorAndStopFlow(doc, errText);
              return;
            }
            console.error('[DBE] submit button not found:', label);
            (window.DBE_finishChest ? window.DBE_finishChest() : finishChest());
            return;
          }
          // 中断要求がある場合は、次の宝箱を開ける前に終了（現在の選別処理は完了している想定）
          if (DBE_CHEST._userAbort){
            chestDiag('userAbort: stop before next open');
            (window.DBE_finishChest ? window.DBE_finishChest() : finishChest());
            return;
          }
          dbeScheduleChestOpenRequest(()=>{
            if (DBE_CHEST._userAbort){
              chestDiag('userAbort: stop before queued open submit');
              (window.DBE_finishChest ? window.DBE_finishChest() : finishChest());
              return;
            }
            // 開封回数の加算は dbeSubmitChestOpenElement() 内へ一本化する。
            // ここで外側スコープから dbeChestBumpProcessed() を呼ぶと、
            // 関数スコープ外のため実質的に何も起きず、try/catch で握りつぶされる。
            if (!dbeSubmitChestOpenElement(btn, loc)){
              console.warn('[DBE] chest open submit failed:', loc);
              (window.DBE_finishChest ? window.DBE_finishChest() : finishChest());
            }
          });
          return;
        }
        // 宝箱オープン後は /bag が返る想定
        if (/\/bag(?:$|[?#])/.test(loc)){
          if (DBE_CHEST.stage === 'submit_chest'){
            dbeHandleChestReturnedBagDoc(doc, loc);
            return;
          }
          if (DBE_CHEST.stage === 'locking'){
            // v12.0.1.14:
            // /lock は直接 fetch 送信＋/bag 検証方式へ移行したため、
            // iframe load 側では処理を進めない。
            return;
          }
          if (DBE_CHEST.stage === 'recycling'){
            // v12.0.1.14:
            // /recycle も直接 fetch 送信＋/bag 検証方式へ移行したため、
            // iframe load 側では処理を進めない。
            return;
          }
          if (DBE_CHEST.stage === 'recycle_unlocked'){
            // /recycleunlocked の戻り（/bag）→ 次ループ or 最終解除へ
            afterIterationStep(DBE_CHEST.backgroundBagTables ? doc : (DBE_CHEST.liveDom ? document : doc));
            return;
          }
          if (DBE_CHEST.stage === 'unlock_onhold_prep'){
            // 最終：onhold ID の解除キューを組んで解除へ
            buildUnlockQueueFromIframe(DBE_CHEST.backgroundBagTables ? doc : (DBE_CHEST.liveDom ? document : doc));
            if (DBE_CHEST.qUnlock.length>0){
              DBE_CHEST.stage = 'unlocking';
              scheduleNextUnlock();
            }else{
              (window.DBE_finishChest ? window.DBE_finishChest() : finishChest());
            }
            return;
          }
          if (DBE_CHEST.stage === 'unlocking'){
            // 解除操作は scheduleNextUnlock() 内で次を決める
            return;
          }
        } else {
          // /bag でも /chest でもないページに遷移している（開封フロー中）→ 既知/未知に関わらずサーバーエラー扱い
          const errText = (!isBag && !isChest && DBE_CHEST.stage !== 'idle')
            ? (normalizeChestServerErrorText(doc, loc, chestType) || extractLooseErrorText(doc) || 'Unknown Error')
            : null;
          if (errText){
            console.warn('[DBE] Server error detected during chest-open flow');
            handleServerErrorAndStopFlow(doc, errText);
            return;
          }
        }
      }catch(err){
        console.error('[DBE] onBgFrameLoad error:', err);
        (window.DBE_finishChest && window.DBE_finishChest());
      }
    }

    // === patch (post-define): ensure battlechest opens on iframe load ===
    function dbePatchBattleOpenPostDefine(){
      const orig = window.onBgFrameLoad; // 直前に定義された“本体”を確実に捕まえる
      function findOpenBtn(doc, type){
        const root = doc || document;
        const isBattleType = (t)=> (t==='battle' || t==='battle_normal' || t==='battle_large');
        if (isBattleType(type)){
          // バトル宝箱：標準=A65 / 大型=B70 を hidden chestsize から確実に拾う
          const want = (type==='battle_large') ? 'B70' : 'A65';
          const hidden = root.querySelector(`form[action*="openbattlechest"] input[name="chestsize"][value="${want}"], form[action*="battlechest"] input[name="chestsize"][value="${want}"]`);
          const form = hidden ? hidden.closest('form') : null;
          const btn = form ? (form.querySelector('input[type="submit"], button[type="submit"]')) : null;
          if (btn) return btn;
          // フォールバック（最悪でもsubmitを拾う）
          return root.querySelector('form[action*="openbattlechest"] input[type="submit"], form[action*="battlechest"] input[type="submit"]');
        }
        // 通常宝箱（従来どおり）
        const queries = [
          'form[action*="openchest"] button[type="submit"]',
          'form[action*="openchest"] input[type="submit"]',
          'form[action*="chest"] button[type="submit"]',
          'form[action*="chest"] input[type="submit"]'
        ];
        for (const sel of queries){
          const el = root.querySelector(sel);
          if (el) return el;
        }
        return null;
      }
      window.onBgFrameLoad = function(ev){
        try{
          const fr  = ev && ev.currentTarget;
          const doc = fr && fr.contentDocument;
          const type = (window.DBE_CHEST && window.DBE_CHEST.type) || null;
          const loc = (fr && fr.contentWindow && fr.contentWindow.location)
            ? fr.contentWindow.location.href
            : ((doc && doc.URL) || '');
          // サーバーエラー検知（エラー時は以降の処理を完全停止）
          const err = normalizeChestServerErrorText(doc, loc, type);
          if (err) return handleServerErrorAndStopFlow(doc, err);
          const isBattleType = (t)=> (t==='battle' || t==='battle_normal' || t==='battle_large');
          if (isBattleType(type) && doc && window.DBE_CHEST && window.DBE_CHEST.stage === 'load_chest'){
            // バトル宝箱：まず「開ける」要素を見つけてクリック（ラベル不一致でも action で拾う）
            const openEl = findOpenBtn(doc, type);
            if (openEl){
              if (window.DBE_CHEST && window.DBE_CHEST._userAbort){
                chestDiag('userAbort: stop before next open (battle patch)');
                (window.DBE_finishChest ? window.DBE_finishChest() : undefined);
                return;
              }
              dbeScheduleChestOpenRequest(()=>{
                if (window.DBE_CHEST && window.DBE_CHEST._userAbort){
                  chestDiag('userAbort: stop before queued open submit (battle patch)');
                  (window.DBE_finishChest ? window.DBE_finishChest() : undefined);
                  return;
                }
                // 開封回数の加算は dbeSubmitChestOpenElement() 内へ一本化する。
                // ここで外側スコープから dbeChestBumpProcessed() を呼ぶと、
                // 関数スコープ外のため実質的に何も起きず、try/catch で握りつぶされる。
                if (!dbeSubmitChestOpenElement(openEl, loc)){
                  console.warn('[DBE] battlechest open submit failed (post-define)');
                  (window.DBE_finishChest ? window.DBE_finishChest() : undefined);
                }
              });
              return; // 次の load で /bag へ戻る想定（本体は /bag 側で動作）
            } else {
              console.warn('[DBE] battlechest open element not found (post-define)');
            }
          }
        } catch (e) {
          console.warn('[DBE] battle open patch (post-define) failed:', e);
        }
        // 既存本体も必ず実行（通常/大型フローや後段処理を保持）
        return typeof orig === 'function' ? orig.apply(this, arguments) : undefined;
      };
    }
    dbePatchBattleOpenPostDefine();

    function finishChest(){
      // 進行UIの停止（中断/完了共通）
      try{ (window.DBE_CHEST = window.DBE_CHEST || {})._autoRunning = false; }catch(_){ }
      try{ (window.DBE_CHEST = window.DBE_CHEST || {})._directChestOpenBusy = false; }catch(_){ }
      try{ if (typeof dbeFinishProgressUI === 'function') dbeFinishProgressUI(); }catch(_){ }
      try{ dbeCancelPendingChestOpenRequest(); }catch(_){}
      // 終了メッセージ
      hideOverlay();
      DBE_CHEST.stage   = 'idle';
      DBE_CHEST.busy    = false;
      // HUD終了
      try{ stopProgressHud(); }catch(_){}
      console.log('[DBE] Chest flow finished');
      // 追加マーキング：未ロックかつ未マーキングへ onhold を付与（失敗は握りつぶし）
      try{
        if (!DBE_CHEST.backgroundBagTables){
          applyOnHoldToCurrentUnlocked(/*onlyNotMarked=*/true);
        }
      }catch(_){}
      // ★ 自動で OFF → ON と切り替えた列表示状態を元に戻す
      try{ __dbeRestoreColsAfterRun(); }catch(_){}
      DBE_CHEST.onHoldIds = new Set();
      DBE_CHEST.backgroundBagTables = false;
      DBE_CHEST._backgroundBagSnapshotDoc = null;
      DBE_CHEST._pendingBgAction = null;
      DBE_CHEST._pendingBgActionId = null;
      DBE_CHEST._directActionBusy = false;
      DBE_CHEST._openGateToken = (Number(DBE_CHEST._openGateToken || 0) + 1);
      // v12.0.1.2:
      // 宝箱／バトル宝箱の処理終了時にページを自動リロードしない。
      // リロードが走ると #dbe-W-Chest / #dbe-W-ChestProgress などのモーダルが
      // 結果的に閉じてしまうため、終了後も各モーダルをそのまま維持する。
      DBE_CHEST.didWork = false;
      try{
        const chestWnd = document.getElementById('dbe-W-Chest');
        if (chestWnd) chestWnd.style.display = 'inline-block';
      }catch(_){}
      try{
        const progWnd = document.getElementById('dbe-W-ChestProgress');
        if (progWnd) {
          progWnd.style.display = 'inline-block';
          dbeBringToFront(progWnd);
        }
      }catch(_){}
      return;
    }
    // expose for external handlers
    window.DBE_finishChest = finishChest;

    // ── 新規ID抽出（表示中メイン） ──
    function collectIdsFromMain(kind){
      const doc = document;
      const ids = new Set();
      const sel = kind==='wep' ? '#weaponTable' : (kind==='amr' ? '#armorTable' : '#necklaceTable');
      const table = doc.querySelector(sel);
      if (!table || !table.tBodies[0]) return ids;
      const map = headerMap(table);
      const iEqup = map['装']; // 装列（装備リンク）からIDを取る
      if (iEqup<0) return ids;
      Array.from(table.tBodies[0].rows).forEach(tr=>{
        const a = tr.cells[iEqup]?.querySelector('a[href*="/equip/"]');
        const id = a?.href?.match(/\/equip\/(\d+)/)?.[1];
        if (id) ids.add(id);
      });
      return ids;
    }

   // ── メインページで未ロック（/lock/）の行にマーキング付与 ──
    function markOnHoldInMain(){
      const mark = (tableSel)=>{
        const table = document.querySelector(tableSel);
        if (!table || !table.tBodies[0]) return;
        const map = headerMap(table);
        const iEqup = map['装'], iLock = map['解'];
        if (iEqup<0 || iLock<0) return;
        Array.from(table.tBodies[0].rows).forEach(tr=>{
          const lockA = tr.cells[iLock]?.querySelector('a[href]');
          const aEqup = tr.cells[iEqup]?.querySelector('a[href*="/equip/"]');
          const id = aEqup?.href?.match(/\/equip\/(\d+)/)?.[1];
          if (!id || !lockA) return;
          const href = String(lockA.getAttribute('href')||'');
          if (href.includes('/lock/')){ // 未ロック（＝ロック操作が可能）
            tr.classList.add('dbe-prm-Chest--onhold');
          }
        });
      };
      ['#necklaceTable','#weaponTable','#armorTable'].forEach(mark);
    }

    // ── メインページから onhold マーク済みIDを収集 ──
    function collectOnHoldIds(){
      const ids = new Set();
      const collect = (tableSel)=>{
        const table = document.querySelector(tableSel);
        if (!table || !table.tBodies[0]) return;
        const map = headerMap(table);
        const iEqup = map['装'];
        if (iEqup<0) return;
        Array.from(table.tBodies[0].rows).forEach(tr=>{
          if (!tr.classList.contains('dbe-prm-Chest--onhold')) return;
          const a = tr.cells[iEqup]?.querySelector('a[href*="/equip/"]');
          const id = a?.href?.match(/\/equip\/(\d+)/)?.[1];
          if (id) ids.add(id);
        });
      };
      ['#necklaceTable','#weaponTable','#armorTable'].forEach(collect);
      return ids;
    }

    // ── 既存の未ロックIDを収集（実ページDOMは書き換えない） ──
    function collectUnlockedIdsFromMain(){
      const ids = new Set();
      const collect = (tableSel)=>{
        const table = document.querySelector(tableSel);
        if (!table || !table.tBodies[0]) return;
        const map = headerMap(table);
        const iEqup = map['装'];
        const iLock = map['解'];
        if (iEqup<0 || iLock<0) return;
        Array.from(table.tBodies[0].rows).forEach(tr=>{
          const lockA = tr.cells[iLock]?.querySelector('a[href]');
          const href = String(lockA?.getAttribute('href') || '');
          if (!href.includes('/lock/')) return; // 未ロックのみ
          const a = tr.cells[iEqup]?.querySelector('a[href*="/equip/"]');
          const id = a?.href?.match(/\/equip\/(\d+)/)?.[1];
          if (id) ids.add(id);
        });
      };
      ['#necklaceTable','#weaponTable','#armorTable'].forEach(collect);
      return ids;
    }

    // ── 未ロック（/lock/）かつ未マーキングの行へ onhold を付与 ──
    function applyOnHoldToCurrentUnlocked(onlyNotMarked){
      const apply = (tableSel)=>{
        const table = document.querySelector(tableSel);
        if (!table || !table.tBodies[0]) return;
        const map = headerMap(table);
        const iLock = map['解'];
        if (iLock<0) return;
        Array.from(table.tBodies[0].rows).forEach(tr=>{
          const lockA = tr.cells[iLock]?.querySelector('a[href]');
          if (!lockA) return;
          const href = String(lockA.getAttribute('href')||'');
          if (href.includes('/lock/')){ // 未ロック
            if (!onlyNotMarked || !tr.classList.contains('dbe-prm-Chest--onhold')){
              tr.classList.add('dbe-prm-Chest--onhold');
            }
          }
        });
      };
      ['#necklaceTable','#weaponTable','#armorTable'].forEach(apply);
    }

    // 〓〓〓 宝箱を連続開封し、選別してロックor分解or保留する 〓〓〓
    function buildLockQueuesAfterOpen(doc){

      // ロック／分解の間隔は固定（ミリ秒）
      // 宝箱／バトル宝箱の開封間隔は dbeScheduleChestOpenRequest() 側で別制御する。
      DBE_CHEST.delay = ()=>50;

      // 共通ヘルパー：ネックレス効果解析（Buff/DeBuffの個数、増減％合計、unknown）
      function dbeParseNecEffects(tr, iAttr, iName){
        // 診断フラグ：window.DBE_DEBUG===true もしくは window.DBE_DEBUG.nec が真なら詳細ログを出力
        const DBG = !!(window.DBE_DEBUG && (window.DBE_DEBUG===true || window.DBE_DEBUG.nec));
        let buffCnt = 0, debuffCnt = 0, deltaTot = NaN, unknownCnt = 0;
        const details = []; // {k,v,type}
        if (iAttr >= 0){
          const cell = tr.cells[iAttr];
          const _buff   = Array.isArray(buffKeywords)   ? buffKeywords   : [];
          const _debuff = Array.isArray(debuffKeywords) ? debuffKeywords : [];
          if (cell){
            cell.querySelectorAll('li').forEach(function(li){
              const raw = (li.dataset && li.dataset.dbeNecAttrOriginal)
                ? String(li.dataset.dbeNecAttrOriginal || '').trim()
                : String(li.textContent || '').trim();
              const v = dbeGetNecklaceAttrDeltaValue(li, _buff, _debuff);
              if (typeof v !== 'number' || !Number.isFinite(v)) return;

              const mm = raw.match(/^\[[^\]\+\-]+([+-])\]\s*[^:]+:\s*\d+%\s+(.+)$/);
              const sign = mm ? mm[1] : (v < 0 ? '-' : '+');
              const k = mm ? (mm[2] || '').trim() : (sign === '-' ? 'simple-debuff' : 'simple-buff');

              if (v >= 0) {
                buffCnt++;
                deltaTot = (isNaN(deltaTot)?0:deltaTot) + v;
                if (DBG) details.push({k,v,type:'buff'});
              } else {
                debuffCnt++;
                deltaTot = (isNaN(deltaTot)?0:deltaTot) + v;
                if (DBG) details.push({k,v:Math.abs(v),type:'debuff'});
              }
            });
          }
        }
        if (DBG){
          try{
            const unk = details.filter(d=>d.type==='unknown').map(d=>d.k);
            console.debug('[DBE][NEC] effects buff=%d debuff=%d delta=%s unknown=%d', buffCnt, debuffCnt, (isNaN(deltaTot)?'NaN':deltaTot), unknownCnt);
            if (details.length){
              console.debug('[DBE][NEC] details:', details);
            }
            if (unk.length){
              console.debug('[DBE][NEC] unknown keys:', Array.from(new Set(unk)));
            }
          }catch(_e){}
        }
        return { buffCnt, debuffCnt, delta: deltaTot, unknownCnt, hasUnknown: unknownCnt>0 };
      }

      const onlyNew  = !!DBE_CHEST.onlyNew;
      const onHoldId = DBE_CHEST.onHoldIds || new Set();
      const newIdsLoop = new Set();   // この関数の1回の走査で見付けた「新規」ID

      const pushNewFrom = (sel, kind, preSet)=>{
        const table = doc.querySelector(sel);
        if (!table || !table.tBodies[0]) return;
        // v12.1.0.1:
        // アイテムバッグ整理では「対象外テーブルをDOMから除去」してから本関数を流用する。
        // また、旧初期値では DBE_CHEST.pre.nec が存在しない場合があり、
        // ネックレス整理時に preSet.has(id) で例外になるため、必ず Set として扱う。
        preSet = (preSet && typeof preSet.has === 'function') ? preSet : new Set();
        const map = headerMap(table);
        const iName  = map[kind==='wep'?'武器':(kind==='amr'?'防具':'ネックレス')];
        const iEqup  = map['装'];
        const iElem  = map['ELEM']>=0 ? map['ELEM'] : (map['属性']>=0? map['属性'] : -1);
        const iMrm   = map['マリモ'];
        const iRar   = map['Rarity']>=0 ? map['Rarity'] : (map['レアリティ']>=0? map['レアリティ'] : -1);
        const iLock  = map['解'];
        const iAttr  = (map['属性']>=0 ? map['属性'] : (map['ELEM']>=0? map['ELEM'] : -1));
        // 分解リンク列（/recycle/）の列インデクス
        const iRycl  = map['分解'];

        // ☆ 追加：武器は SPD、防具は WT. の列インデクスを拾う
        // テーブル見出しから SPD（武器） と WT.（防具） の列インデクスを取得
        // rowInfo に spd／wt 数値を格納（行セルから数値抽出）
        // ** 注意点として、防具の「WT.」見出しはドット付きが前提です（headerMap で 'WT.' を引いています）。
        // ** もし実ページ側ヘッダーが「WT」等へ変わるとインデクスが取れず、このパッチでも評価できません
        // ** 実ヘッダー表記が「WT.」であることを維持ください。
          const iSpd   = (kind==='wep') ? map['SPD']  : -1;
          const iWgt   = (kind==='amr') ? map['WT.']  : -1;
          const iAtk   = (kind==='wep') ? map['ATK']  : -1;
          const iDef   = (kind==='amr') ? map['DEF']  : -1;
          const iCrit  = (kind==='wep' || kind==='amr') ? map['CRIT'] : -1;

          // ☆ どの列が必要かは、現在のカード内容から動的に決める
          //    可能な限り両方の保存先に対応（_rulesData / DBE_RULES）
          const rulesRaw =
            (window.DBE_RULES && Array.isArray(window.DBE_RULES[kind]) ? window.DBE_RULES[kind] :
            (Array.isArray(window._rulesData?.[kind]) ? window._rulesData[kind] : [])) || [];

          const needRar  = rulesRaw.some(r => Array.isArray(r.rar)  ? r.rar.length>0  : !!r.rar);
          const needElem = rulesRaw.some(r => Array.isArray(r.elem) ? r.elem.length>0 : !!r.elem);
          const needMrm  = rulesRaw.some(r => r.mrm && r.mrm.mode === 'spec');
          // 武器/防具の数値比較フラグ（SPD / WT.）
          const needSpd  = (kind==='wep') && rulesRaw.some(r => r && r.spd && String(r.spd.value ?? '') !== '');
          const needWgt  = (kind==='amr') && rulesRaw.some(r => r && r.wt  && String(r.wt.value  ?? '') !== '');
          // 追加：武器 ATK(min/max) / 防具 DEF(min/max) / 武器・防具 CRIT
          const needAtk  = (kind==='wep') && rulesRaw.some(r => {
            const mn = r && r.minATK && String(r.minATK.value ?? '') !== '';
            const mx = r && r.maxATK && String(r.maxATK.value ?? '') !== '';
            return mn || mx;
          });
          const needDef  = (kind==='amr') && rulesRaw.some(r => {
            const mn = r && r.minDEF && String(r.minDEF.value ?? '') !== '';
            const mx = r && r.maxDEF && String(r.maxDEF.value ?? '') !== '';
            return mn || mx;
          });
          const needCrit = (kind==='wep' || kind==='amr') && rulesRaw.some(r => {
            const c = (r && (r.crit || r.CRIT));
            if (!c) return false;
            return String(c.value ?? '') !== '';
          });
          // 分解ルールが1つでもあれば「分解」列を必須扱いにする
          const needRecycle = rulesRaw.some(r => r && r.type === 'del');

          const needGrade = (kind==='nec') && rulesRaw.some(r => r && r.grade && !r.grade.all && Array.isArray(r.grade.list) && r.grade.list.length>0);
          const needProp  = (kind==='nec') && rulesRaw.some(r => r && (r.prop || r.propCount || r.property) && !(r.prop || r.propCount || r.property).all);
          const needBuff  = (kind==='nec') && rulesRaw.some(r => r && r.buff   && !r.buff.all);
          const needDebuff= (kind==='nec') && rulesRaw.some(r => r && r.debuff && !r.debuff.all);
          const needDelta = (kind==='nec') && rulesRaw.some(r => r && r.delta  && !r.delta.all && String(r.delta.value ?? '') !== '');

          // ☆ 必須列の検証（不足があれば一覧を出して中断）
          const missing = [];

          // 名前列：武器 or 防具（rowInfo.name 正常化に使用）
          if (iName < 0) missing.push(kind==='wep' ? '武器' : (kind==='amr' ? '防具' : 'ネックレス'));

          // 動作列：装/解（ロック・分解のクリックに必須）
          // ※ map での重複チェックは不要。iEqup / iLock に一本化する。
          if (iEqup < 0) missing.push('装');
          if (iLock < 0) missing.push('解');
          if (needRecycle && (map['分解'] ?? -1) < 0) missing.push('分解');

          // 条件列：カードが使っているものだけ必須化
          if (needElem && (map['ELEM'] ?? -1) < 0) missing.push('ELEM');
          if (needMrm  && iMrm < 0)              missing.push('マリモ');
          if (needRar  && iRar < 0)              missing.push('Rarity/レアリティ');
          if (needSpd  && iSpd < 0)              missing.push('SPD');
          if (needWgt  && iWgt < 0)              missing.push('WT.');
          if (needAtk  && iAtk < 0)              missing.push('ATK');
          if (needDef  && iDef < 0)              missing.push('DEF');
          if (needCrit && iCrit < 0)             missing.push('CRIT');
          if (kind==='nec' && (needProp || needBuff || needDebuff || needDelta) && iAttr < 0) missing.push('属性');
          if (missing.length > 0){
            // 重複除去
            { const uniq=[]; for (const m of missing){ if(!uniq.includes(m)) uniq.push(m);} missing.length=0; missing.push(...uniq); }
            const tbl = table.id || '(no id)';
            const msg = [
              '以下の列を検出できませんでした：',
              ' - ' + missing.join('\n - '),
              `テーブル: ${tbl}`,
              '',
              '列ヘッダーの表記ゆれ（例：WT. のドット有無）や列の非表示化が原因の可能性があります。'
            ].join('\n');
            console.error('[DBE][ERROR] Missing columns: %o (table=%s)', missing, tbl);
            dbeAbortChest(msg);
            return;
          }

          // ☆ 参考ログ（見つかった主な列のインデクス）
          console.debug('[DBE] header indices: table=%s kind=%s name=%d equip(装)=%d unlock(解)=%d elem=%d mrm=%d rar=%d spd=%d wt.=%d atk=%d def=%d crit=%d',
            table.id || '(no id)', kind, iName, iEqup, iLock, map['ELEM'] ?? -1, iMrm, iRar, iSpd, iWgt, iAtk, iDef, iCrit);

          // ☆ 追加：数値抽出ヘルパー（空や非数値は NaN になる＝判定時に不一致で落とす）
          const numFromCell = (td)=> {
            const raw = String(td?.textContent || '').normalize('NFKC');
            const m = raw.match(/-?\d+(?:\.\d+)?/);
            if (!m) return NaN;
            const v = parseFloat(m[0]);
            return Number.isFinite(v) ? v : NaN;
          };

          // ☆ 追加：範囲（min/max）抽出ヘルパー（ATK/DEF 用）
          // - まず「a-b」「a～b」「a〜b」のような範囲表記を優先
          // - 見つからなければ、セル中の独立した数値トークン先頭2つを使う
          const rangeFromCell = (td)=>{
            const raw = String(td?.textContent || '').normalize('NFKC');

            // 1) 範囲表記を優先
            let m = raw.match(/(-?\d+(?:\.\d+)?)\s*(?:[~〜～\-−ー－]\s*)(-?\d+(?:\.\d+)?)/);
            if (m){
              const a = parseFloat(m[1]);
              const b = parseFloat(m[2]);
              return {
                min: Number.isFinite(a) ? a : NaN,
                max: Number.isFinite(b) ? b : NaN
              };
            }

            // 2) フォールバック：独立した数値トークン
            const nums = raw.match(/-?\d+(?:\.\d+)?/g);
            if (!nums || !nums.length) return {min:NaN, max:NaN};
            const a = parseFloat(nums[0]);
            const b = (nums.length > 1) ? parseFloat(nums[1]) : a;
            return {
              min: Number.isFinite(a) ? a : NaN,
              max: Number.isFinite(b) ? b : NaN
            };
          };

          // ☆ 追加：マリモ抽出ヘルパー
          // - 既存実装のようにセル中の数字を全部連結しない
          // - 「先頭側の独立した数値」または「マリモ直前/直後の数値」を優先
          const marimoFromCell = (td)=>{
            const raw = String(td?.textContent || '').normalize('NFKC').trim();
            if (!raw) return NaN;

            // 1) 「マリモ 2」「2 マリモ」など、語の近傍を優先
            let m =
              raw.match(/マリモ\D*(-?\d+(?:\.\d+)?)/i) ||
              raw.match(/(-?\d+(?:\.\d+)?)\D*マリモ/i);
            if (m){
              const v = parseFloat(m[1]);
              return Number.isFinite(v) ? v : NaN;
            }

            // 2) 先頭側の独立した数値を採用
            m = raw.match(/-?\d+(?:\.\d+)?/);
            if (!m) return NaN;
            const v = parseFloat(m[0]);
            return Number.isFinite(v) ? v : NaN;
          };

        const rulesSnap = dbeGetRulesSnapshotForSelection();
        Array.from(table.tBodies[0].rows).forEach(tr=>{

          const a = tr.cells[iEqup]?.querySelector('a[href*="/equip/"]');
          const id = a?.href?.match(/\/equip\/(\d+)/)?.[1];
          if (!id) return;
          // ① onhold 付与済みは「保留」＝選別（ロック/分解）対象からスキップ
          if (onHoldId.has(id)) return;
          // ↓ ここを追加（preSetに無ければ「新規」）
          if (!preSet.has(id)) newIdsLoop.add(id);
          // ロック/解錠セル（列特定に失敗した場合は行全体から推定）
          const lockCand = (iLock>=0 ? tr.cells[iLock] : tr);
          const aLock = lockCand?.querySelector?.('a[href*="/lock/"], a[href*="/unlock/"]');
          const hrefL = String(aLock?.getAttribute?.('href')||'');
          // onlyNew=ON（既定）：既存は対象外（新規のみ評価）
          if (onlyNew && preSet.has(id)) return;
          // ルール評価：'lock'→ロックキュー、'del'→分解キュー、null→保留
          // ★ rarity フォールバック強化：行全体からも抽出
          const _rawName = iName>=0 ? (tr.cells[iName]?.textContent||'') : '';
          const _rawRar  = iRar>=0  ? (tr.cells[iRar]?.textContent||'')  : '';
          const _rowText = tr.textContent || '';
          const _rarHit  = dbePickRarityFromText(_rawRar)
                          || dbePickRarityFromText(_rawName)
                          || dbePickRarityFromText(_rowText)
                          || '';
          // ★ element フォールバック強化：行全体からも抽出
          const pickElem = ()=>{
            const candidates = ['火','氷','雷','風','地','水','光','闇','なし'];

            // 1) 明示列があれば最優先。ただし失敗時に即 unknown にはせず、後段へフォールバックする
            if (iElem>=0){
              const rawElemCell = tr.cells[iElem]?.textContent || '';
              const norm = normalizeElem(rawElemCell);
              if (norm) return norm;
            }

            // 2) 名称セル・行全体から再推測
            //    （ELEM列の文字列が崩れている/空でも、他セルに属性語が残っていれば拾う）
            {
              const probes = [
                _rawName || '',
                _rowText || ''
              ];
              for (const src of probes){
                const norm = normalizeElem(src);
                if (norm) return norm;
              }
            }

            // 3) normalizeElem を通さない素朴探索（最後の保険）
            {
              const probes = [
                tr.cells[iElem]?.textContent || '',
                _rawName || '',
                _rowText || ''
              ];
              for (const src of probes){
                const txt = String(src || '').normalize('NFKC');
                for (const err of candidates){
                  if (txt.includes(err)) return err;
                }
              }
            }

            // 4) 見つからなければ未特定
            return '__unknown__';
          };

          const atkR = (kind==='wep' && iAtk>=0) ? rangeFromCell(tr.cells[iAtk]) : null;
          const defR = (kind==='amr' && iDef>=0) ? rangeFromCell(tr.cells[iDef]) : null;
          const rowInfo = {
            id,
            name : normalizeItemName(_rawName),
            elem : pickElem(),
            mrm  : iMrm>=0 ? marimoFromCell(tr.cells[iMrm]) : NaN,
            rar  : _rarHit,
            kind,
            // ☆ 追加：行から SPD / WT. / ATK / DEF / CRIT を数値抽出（なければ NaN）
            spd  : (kind==='wep' && iSpd>=0) ? numFromCell(tr.cells[iSpd]) : NaN,
            wt   : (kind==='amr' && iWgt>=0) ? numFromCell(tr.cells[iWgt]) : NaN,
            atkMin : atkR ? atkR.min : NaN,
            atkMax : atkR ? atkR.max : NaN,
            defMin : defR ? defR.min : NaN,
            defMax : defR ? defR.max : NaN,
            crit : ((kind==='wep' || kind==='amr') && iCrit>=0) ? numFromCell(tr.cells[iCrit]) : NaN
          };
          if (kind==='nec'){
            // ネックレス: グレード／Buff個数／DeBuff個数／増減（％合計）
            const grade = (function(){
              const m = (_rowText||'').match(/プラチナ|金|銀|青銅|銅/);
              return m ? m[0] : '';
            })();
            const nec = dbeParseNecEffects(tr, iAttr, iName);
            rowInfo.grade = grade;
            rowInfo.buffCnt = nec.buffCnt;
            rowInfo.debuffCnt = nec.debuffCnt;
            rowInfo.delta = nec.delta;
            rowInfo.unknownCnt = nec.unknownCnt;
            rowInfo.hasUnknown = nec.hasUnknown;
          }

          const act = decideAction(rowInfo, rulesSnap); // 'lock' | 'del' | null
          if (act==='lock' && hrefL.includes('/lock/')){
            DBE_CHEST.qLock.push({table:kind, id});
          } else if (act==='del'){
            // 一括分解モードでは、フィルタカードによる分解対象を /recycle キューには積まない。
            // ロック対象だけを先に /lock し、その後 /recycleunlocked で未ロック装備を一括分解する。
            if (DBE_CHEST.recycleUnlockedBulk){
              return;
            }
            // 分解は「未ロック」かつ「分解リンクが存在」する行だけを対象にする
            const recCand = (iRycl>=0 ? tr.cells[iRycl] : tr);
            const ryclA = recCand?.querySelector?.('a[href*="/recycle/"]');
            if (hrefL.includes('/lock/') && ryclA){
              // 仕様上：wep/amr のみ（necklaceTable は今回対象外）
              DBE_CHEST.qRecycle.push({table:kind, id});
            }
          } else {
            // 保留（どちらにも該当しない）:
            // 同一セッション内での再判定を避けるため、未ロック行に限り即 onhold を付与
            if (hrefL.includes('/lock/')){
              tr.classList.add('dbe-prm-Chest--onhold');
              onHoldId.add(id); // この Set は DBE_CHEST.onHoldIds を参照している
            }
          }
        });
        // HUD更新：このテーブルで積まれた残件を即時反映
        try{ tickProgressHud(); }catch(_){}
      };
    pushNewFrom('#weaponTable',   'wep', DBE_CHEST.pre && DBE_CHEST.pre.wep);
    pushNewFrom('#armorTable',    'amr', DBE_CHEST.pre && DBE_CHEST.pre.amr);
    pushNewFrom('#necklaceTable', 'nec', DBE_CHEST.pre && DBE_CHEST.pre.nec);
    DBE_CHEST.newFound = newIdsLoop.size;
    console.log('[DBE] new-found=', DBE_CHEST.newFound);
    console.log('[DBE] lock-queue=', DBE_CHEST.qLock);
    console.log('[DBE] recycle-queue=', DBE_CHEST.qRecycle);
    }

    // 〓〓〓 名前の正規化: 装飾（【武器】【防具】や [UR|SSR|SR|R|N]）を外し、全角/半角空白を圧縮 〓〓〓
    function normalizeItemName(raw){
      const s = String(raw || '');
      return s
        .replace(/【[^】]*】/g, '')       // 【武器】【防具】などを除去
        .replace(/\[(UR|SSR|SR|R|N)\]/g, '') // [UR][SSR] 等を除去
        .replace(/\s+/g, ' ')            // 半角空白の連続を1つに
        .replace(/[\u3000]+/g, ' ')      // 全角空白→半角1つ
        .trim();
    }

    // 〓〓〓 エレメント名の正規化（表記ゆれ吸収） 〓〓〓
    function normalizeElem(raw){
      const s = String(raw||'').normalize('NFKC').trim();
      if(!s) return '';

      const allow = ['火','氷','雷','風','地','水','光','闇','なし'];
      const allowSet = new Set(allow);

      // 1) まず文字列中に属性語がそのまま含まれていれば優先採用
      //    （例: "ELEM 火", "属性: 水", "[闇]" など）
      for (const e of allow){
        if (s.includes(e)) return e;
      }

      // 2) ノイズ除去後に厳密一致
      const t = s
        .replace(/[\u3000\s]+/g,' ')
        .replace(/[［］\[\]【】()（）]/g,' ')
        .replace(/属性|ELEM|ELEMENT|elem|element|Attr|ATTR/gi,' ')
        .replace(/[:：]/g,' ')
        .trim();

      // 同義語 → 正規化
      const map = {
        '無':'なし',
        '無属性':'なし',
        'none':'なし',
        'None':'なし',
        'ナシ':'なし'
      };
      const v = map[t] || t;
      if (allowSet.has(v)) return v;

      // 3) 最後の保険：空白区切りトークンから拾う
      const toks = t.split(/\s+/).filter(Boolean);
      for (const tok of toks){
        const vv = map[tok] || tok;
        if (allowSet.has(vv)) return vv;
      }
      return '';
    }

    // 〓〓〓 エレメント一致判定（'不問'（旧:すべて）なら無条件通過。unknownは不一致） 〓〓〓
    function matchElementRule(rule, elemVal){
      // 1) ルールの目標を配列化
      let targets = [];
      if (rule.elm && Array.isArray(rule.elm.selected) && rule.elm.selected.length){
        targets = rule.elm.selected.map(normalizeElem).filter(Boolean);
      } else if (rule.elem){
        if (rule.elem === '不問' || rule.elem === 'すべて') return true; // 無条件通過（互換）
        targets = [ normalizeElem(rule.elem) ].filter(Boolean);
      } else {
        // 指定なし → 通過
        return true;
      }
      // 2) unknown の扱い
      if (elemVal === '__unknown__') return false;
      // 3) 厳密一致
      return targets.includes(elemVal);
    }

    // 〓〓〓 規則評価用：数値しきい値の正規化 〓〓〓
    // - 全角数字を含む入力を NFKC で半角化
    // - 数字/小数点/符号 以外を除去
    // - 空や非数値は NaN
    function dbeRuleThresholdNumber(raw){
      const s = String(raw ?? '')
        .normalize('NFKC')
        .replace(/[^\d.\-]/g,'')
        .trim();
      if (!s) return NaN;
      const n = Number(s);
      return Number.isFinite(n) ? n : NaN;
    }

    // 〓〓〓 複数選択ルールの正規化（Rarity / Element） 〓〓〓
    // - 旧形式/新形式/複数選択/全選択 を同じ基準で扱う
    // - 「全選択」は非アクティブ（= 前段フィルタを素通し）として扱う
    function dbeNormalizeRarityRule(raw){
      const ALL = ['UR','SSR','SR','R','N'];
      const allow = new Set(ALL);

      // 未指定 / 互換の「すべて」
      if (!raw) return { active:false, list:[] };
      if (typeof rarityIsAll === 'function' && rarityIsAll(raw)) {
        return { active:false, list:[] };
      }
      if (raw === 'すべて' || raw === '不問' || raw === '選択してください') {
        return { active:false, list:[] };
      }

      let picked = [];
      if (Array.isArray(raw)){
        picked = raw.map(v=>String(v||'').trim()).filter(v=>allow.has(v));
      } else if (typeof raw === 'string'){
        const v = String(raw||'').trim();
        if (allow.has(v)) picked = [v];
      } else if (typeof raw === 'object'){
        picked = ALL.filter(k => !!raw[k]);
      }

      // 重複除去
      picked = Array.from(new Set(picked));

      // 全5種選択は「すべて」と同義にする
      if (picked.length >= ALL.length) {
        return { active:false, list:[] };
      }
      return { active:(picked.length > 0), list:picked };
    }

    function dbeNormalizeElementRule(rule){
      const ALL = ['火','氷','雷','風','地','水','光','闇','なし'];
      const allow = new Set(ALL);

      // 新形式 elm 優先
      if (rule && rule.elm){
        const all = !!rule.elm.all;
        const picked = Array.isArray(rule.elm.selected)
          ? Array.from(new Set(rule.elm.selected.map(normalizeElem).filter(v=>allow.has(v))))
          : [];
        if (all || picked.length >= ALL.length) {
          return { active:false, list:[] };
        }
        return { active:(picked.length > 0), list:picked };
      }

      // 旧形式 elem 互換
      const raw = rule ? rule.elem : null;
      if (!raw) return { active:false, list:[] };
      if (raw === 'すべて' || raw === '不問') return { active:false, list:[] };

      let picked = [];
      if (Array.isArray(raw)){
        picked = raw.map(normalizeElem).filter(v=>allow.has(v));
      } else if (typeof raw === 'string'){
        const v = normalizeElem(raw);
        if (allow.has(v)) picked = [v];
      } else if (typeof raw === 'object'){
        picked = ALL.filter(k => !!raw[k]).map(normalizeElem).filter(v=>allow.has(v));
      }

      picked = Array.from(new Set(picked));
      if (picked.length >= ALL.length) {
        return { active:false, list:[] };
      }
      return { active:(picked.length > 0), list:picked };
    }

    // 〓〓〓 規則評価：最初に合致したルールの action を採用（上から順=「▲」の並び順） 〓〓〓
      function decideAction(rowInfo, rulesSnap){
        // rowInfo: {id,name,elem,mrm,rar,kind, spd, wt, atkMin, atkMax, defMin, defMax, crit, (nec: grade,buffCnt,debuffCnt,delta,unknown...) }
        if (rowInfo && rowInfo.kind==='nec' && rowInfo.hasUnknown) {
          return null;
        }
        // rowInfo: { id, name, elem, mrm, rar, kind, spd, wt }
        // rulesSnap: { nec[], wep[], amr[] }  … 宝箱選別時は保存済みJSON優先のスナップショット
        const rules = (rulesSnap && typeof rulesSnap === 'object')
          ? rulesSnap
          : dbeGetRulesSnapshotForSelection();
        const list = (rowInfo.kind==='wep') ? (rules.wep || []) : (rowInfo.kind==='amr' ? (rules.amr || []) : (rules.nec || []));

        for (const r of list){

          // ============================================================
          // 武器/防具：指定仕様（カードを上から順に1枚ずつ処理）
          // (1) まず《武器名/防具名》でフィルタ（該当しないなら以降スキップ＝保留）
          // (2) 続いて《Rarity》でフィルタ（該当しないなら以降スキップ＝保留）
          // (3) 続いて《Element》でフィルタ（該当しないなら以降スキップ＝保留）
          // (4) 《動作モード》は r.type（lock/del）として現状維持
          // (5) 《ロジック》AND/OR を反映（r.fop）
          // (6) 5条件 {SPD/WT, min, max, CRIT, マリモ} を AND/OR 評価（Element は必須フィルタ側）
          // ============================================================
          if (rowInfo.kind==='wep' || rowInfo.kind==='amr'){
            // 前段アクティブ判定（“完全に条件なしカード”の安全弁用）
            let nameActive = false;
            let rarityActive = false;
            let elemActive = false;
            // (1) 名前で先にフィルタ
            if (r.name && r.name.mode==='spec'){
              const words = String(r.name.keywords||'')
                .split(/[;；]+/)
                .map(s=> normalizeItemName(s))
                .filter(Boolean);
              const lhs = normalizeItemName(rowInfo.name);
              nameActive = (words.length > 0);
              if (words.length && !words.some(wnd => lhs === wnd)) continue; // ← 名前不一致なら以降スキップ（保留）
            }

            {
              const rr = dbeNormalizeRarityRule(r.rarity);
              const active = !!rr.active;
              const matched = !active ? true : rr.list.includes(rowInfo.rar);
              rarityActive = active;
              // Rarity 不一致なら以降スキップ（保留）
              if (active && !matched) continue;
            }

            // (3) Element でフィルタ（※「すべて」は非アクティブ＝判定スキップ）
            {
              const er = dbeNormalizeElementRule(r);
              const active = !!er.active;
              const matched = !active ? true : er.list.includes(rowInfo.elem);
              elemActive = active;
              // Element 不一致なら以降スキップ（保留）
              if (active && !matched) continue;
            }

            const op = String(r.fop || 'AND').toUpperCase();
            const useOr = (op === 'OR');
            let anyActive = false;
            let anyMatch  = false;
            let allMatch  = true;
            const apply = (active, matched)=>{
              if (!active) return;
              anyActive = true;
              if (matched) anyMatch = true;
              else allMatch = false;
            };

            // ── SPD（武器）/ WT.（防具） ※未指定（all）は extra に入らないので非アクティブ
            if (rowInfo.kind==='wep'){
              const st = r.spd;
              if (st){
                const v  = rowInfo.spd;
                const th = dbeRuleThresholdNumber(st.value);
                const matched =
                  Number.isFinite(v) && Number.isFinite(th) &&
                  ((st.border==='以上') ? (v>=th) : (st.border==='未満') ? (v<th) : false);
                apply(true, matched);
              }
            } else if (rowInfo.kind==='amr'){
              const st = r.wt;
              if (st){
                const v  = rowInfo.wt;
                const th = dbeRuleThresholdNumber(st.value);
                const matched =
                  Number.isFinite(v) && Number.isFinite(th) &&
                  ((st.border==='以上') ? (v>=th) : (st.border==='未満') ? (v<th) : false);
                apply(true, matched);
              }
            }

            // ── min/max（武器：ATK / 防具：DEF） ※未指定（all）は extra に入らないので非アクティブ
            if (rowInfo.kind==='wep'){
              if (r.minATK){
                const th = dbeRuleThresholdNumber(r.minATK.value);
                const v  = rowInfo.atkMin;
                const matched =
                  Number.isFinite(v) && Number.isFinite(th) &&
                  ((r.minATK.border==='以上') ? (v>=th) : (r.minATK.border==='未満') ? (v<th) : false);
                apply(true, matched);
              }
              if (r.maxATK){
                const th = dbeRuleThresholdNumber(r.maxATK.value);
                const v  = rowInfo.atkMax;
                const matched =
                  Number.isFinite(v) && Number.isFinite(th) &&
                  ((r.maxATK.border==='以上') ? (v>=th) : (r.maxATK.border==='未満') ? (v<th) : false);
                apply(true, matched);
              }
            } else if (rowInfo.kind==='amr'){
              if (r.minDEF){
                const th = dbeRuleThresholdNumber(r.minDEF.value);
                const v  = rowInfo.defMin;
                const matched =
                  Number.isFinite(v) && Number.isFinite(th) &&
                  ((r.minDEF.border==='以上') ? (v>=th) : (r.minDEF.border==='未満') ? (v<th) : false);
                apply(true, matched);
              }
              if (r.maxDEF){
                const th = dbeRuleThresholdNumber(r.maxDEF.value);
                const v  = rowInfo.defMax;
                const matched =
                  Number.isFinite(v) && Number.isFinite(th) &&
                  ((r.maxDEF.border==='以上') ? (v>=th) : (r.maxDEF.border==='未満') ? (v<th) : false);
                apply(true, matched);
              }
            }

            // ── CRIT（未指定（all）は extra に入らないので非アクティブ）
            {
              const cr = (r.crit || r.CRIT);
              if (cr){
                const th = dbeRuleThresholdNumber(cr.value);
                const v  = rowInfo.crit;
                const matched =
                  Number.isFinite(v) && Number.isFinite(th) &&
                  ((cr.border==='以上') ? (v>=th) : (cr.border==='未満') ? (v<th) : false);
                apply(true, matched);
              }
            }

            // ── マリモ（mode==='spec' のときだけアクティブ）
            {
              const mm = r.mrm;
              if (mm && mm.mode==='spec'){
                const v  = dbeRuleThresholdNumber(rowInfo.mrm);
                const th = dbeRuleThresholdNumber(mm.value);
                const matched =
                  Number.isFinite(v) && Number.isFinite(th) &&
                  ((mm.border==='以上') ? (v>=th) : (mm.border==='未満') ? (v<th) : false);
                apply(true, matched);
              }
            }

            // ── AND/OR 判定
            // “完全に条件なしカード”はヒット禁止（安全弁）
            //   - 前段（名前/Rarity/Element）が全部「すべて」
            //   - かつ 5条件（SPD/WT/min/max/CRIT/マリモ）が全部「不問」
            // の場合は、例外なくマッチさせない（保留）。
            const frontAll = (!nameActive && !rarityActive && !elemActive);
            if (frontAll && !anyActive) continue;

            // 5条件がすべて非アクティブ（= 不問のみ）の場合は、
            // 前段フィルタ（名前/Rarity/Element）を通過した時点でヒット扱いとする。
            // 5条件にアクティブがある場合のみ、AND/OR 判定で最終評価する。
            if (anyActive){
              if (useOr){
                if (!anyMatch) continue;
              } else {
                if (!allMatch) continue;
              }
            }

            // ここまで到達でマッチ → 動作モードに従う
            return r.type==='lock' ? 'lock' : (r.type==='del' ? 'del' : null);
          }

          // ─────────────────────────────────────────
          // ネックレス：現状維持
          // ─────────────────────────────────────────
          if (r.grade && !r.grade.all){
            const lst = Array.isArray(r.grade.list) ? r.grade.list : [];
            if (lst.length && !lst.includes(rowInfo.grade)) continue;
          }
          // プロパティ数：Buff + DeBuff の合計（新仕様）
          {
            const pr = r.prop || r.propCount || r.property;
            if (pr && !pr.all){
              const n = (Number(rowInfo.buffCnt)||0) + (Number(rowInfo.debuffCnt)||0);
              const th = Number(pr.num)||0;
              if (pr.op==='以上' && !(n>=th)) continue;
              if (pr.op==='未満' && !(n<th)) continue;
            }
          }
          
          // 互換：旧仕様の Buff 個数（既存カード救済）
          if (r.buff && !r.buff.all){
            const n = Number(rowInfo.buffCnt)||0;
            const th = Number(r.buff.num)||0;
            if (r.buff.op==='以上' && !(n>=th)) continue;
            if (r.buff.op==='未満' && !(n<th)) continue;
          }

          if (r.debuff && !r.debuff.all){
            const n = Number(rowInfo.debuffCnt)||0;
            const th = Number(r.debuff.num)||0;
            if (r.debuff.op==='以上' && !(n>=th)) continue;
            if (r.debuff.op==='未満' && !(n<th)) continue;
          }
          if (r.delta && !r.delta.all){
            const v = Number(rowInfo.delta);
            const th = parseFloat(r.delta.value)||0;
            if (!Number.isFinite(v)) continue;
            if (r.delta.op==='以上' && !(v>=th)) continue;
            if (r.delta.op==='未満' && !(v<th)) continue;
          }

          // ここまで到達でマッチ
          return r.type==='lock' ? 'lock' : (r.type==='del' ? 'del' : null);
        }

        return null; // 保留
      }

    // 〓〓〓 ヘッダマップ（列名→index）＋tbodyフォールバック 〓〓〓
    function headerMap(table){
      const map = new Proxy(Object.create(null), { get:(t,k)=> (k in t? t[k] : -1) });
      const ths = table.tHead ? table.tHead.querySelectorAll('th') : [];
      Array.from(ths).forEach((th,i)=>{
        const key = (th.textContent||'').trim();
        if (!key) return;
        map[key] = i;
      });
      // ─ フォールバック: tbody から列を推定 ─
      const body = table.tBodies && table.tBodies[0];
      if (body){
        const rows = Array.from(body.rows).slice(0, 10);
        const colCount = rows.reduce((m,r)=>Math.max(m, r.cells.length), 0);
        const has = (k)=> (map[k] ?? -1) >= 0;
        // 装: /equip/
        if (!has('装')){
          outer1: for (let j=0;j<colCount;j++){
            for (const r of rows){
              if (r.cells[j]?.querySelector?.('a[href*="/equip/"]')){ map['装']=j; break outer1; }
            }
          }
        }
        // 解: /lock/ or /unlock/
        if (!has('解')){
          outer2: for (let j=0;j<colCount;j++){
            for (const r of rows){
              const a = r.cells[j]?.querySelector?.('a[href]');
              const href = a && String(a.getAttribute('href')||'');
              if (href && (href.includes('/lock/') || href.includes('/unlock/'))){ map['解']=j; break outer2; }
            }
          }
        }
        // 分解: /recycle/
        if (!has('分解')){
          outer3: for (let j=0;j<colCount;j++){
            for (const r of rows){
              if (r.cells[j]?.querySelector?.('a[href*="/recycle/"]')){ map['分解']=j; break outer3; }
            }
          }
        }
        // 武器/防具（名前列）: どちらも未検出なら、文字量が最も多い列を採用（装/解/分解を除外）
        if (!has('武器') && !has('防具')){
          const avoid = new Set([map['装'], map['解'], map['分解']].filter(i=>i>=0));
          let bestJ=-1, bestLen=-1;
          for (let j=0;j<colCount;j++){
            if (avoid.has(j)) continue;
            const sum = rows.reduce((s,r)=> s + ((r.cells[j]?.textContent||'').trim().length), 0);
            if (sum>bestLen){ bestLen=sum; bestJ=j; }
          }
          if (bestJ>=0){ map['武器']=bestJ; map['防具']=bestJ; }
        }
        // Rarity/レアリティ
        if (!has('Rarity') && !has('レアリティ')){
          const RSET = new Set(['UR','SSR','SR','R','N']);
          outer4: for (let j=0;j<colCount;j++){
            for (const r of rows){
              const t=(r.cells[j]?.textContent||'').trim();
              if (RSET.has(t)){ map['Rarity']=j; map['レアリティ']=j; break outer4; }
            }
          }
        }
        // ELEM/属性
        if (!has('ELEM') && !has('属性')){
          const ESET = new Set(['火','氷','雷','風','地','水','光','闇','なし']);
          outer5: for (let j=0;j<colCount;j++){
            for (const r of rows){
              const t=(r.cells[j]?.textContent||'').trim();
              if (ESET.has(t)){ map['ELEM']=j; map['属性']=j; break outer5; }
            }
          }
        }
      }
      return map;
    }

    // 〓〓〓 /lock・/recycle 直接送信＋/bag 検証方式 〓〓〓
    function dbeChestNormalizeQueueItemIds(queue){
      const ids = [];
      const seen = new Set();
      try{
        (Array.isArray(queue) ? queue : []).forEach(task=>{
          const id = String(task && task.id || '').trim();
          if (!id || seen.has(id)) return;
          seen.add(id);
          ids.push(id);
        });
      }catch(_){}
      return ids;
    }

    async function dbeChestFetchText(path, opt){
      const url = String(path || '').startsWith('http')
        ? String(path)
        : `${DBE_ORIGIN}${path}`;
      const resp = await fetch(url, Object.assign({
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'follow',
        headers: {
          'Accept': 'text/html, text/plain, */*',
          'X-Requested-With': 'XMLHttpRequest'
        }
      }, opt || {}));
      try{
        return await resp.text();
      }catch(_){
        return '';
      }
    }

    async function dbeChestSendActionQueueOnce(actionName, ids){
      // actionName: 'lock' | 'recycle'
      // v12.0.1.16:
      // サーバーレスポンスは待たない。
      // 指定間隔で fetch を一方的に投げ、成否確認は全送信後の /bag 検証だけで行う。
      for (const id of ids){
        if (DBE_CHEST._userAbort || DBE_CHEST._serverError) return;
        const timing = dbeReadChestActionTiming();
        await new Promise(resolve=>setTimeout(resolve, Math.max(0, Number(timing.waitMs) || 0)));
        try{
          const path = `/${actionName}/${encodeURIComponent(id)}`;
          const url = `${DBE_ORIGIN}${path}`;
          fetch(url, {
            method: 'GET',
            credentials: 'same-origin',
            cache: 'no-store',
            redirect: 'follow',
            keepalive: false,
            headers: {
              'Accept': 'text/html, text/plain, */*',
              'X-Requested-With': 'XMLHttpRequest'
            }
          }).catch(err=>{
            // この段階では中断しない。
            // 後続の /bag 検証で未反映なら再送対象にする。
            console.warn(`[DBE] ${actionName} request failed asynchronously; will verify later:`, id, err);
          });
        }catch(err){
          console.warn(`[DBE] ${actionName} request dispatch failed; will verify later:`, id, err);
        }
      }
    }

    async function dbeChestFetchBagDocForVerify(){
      try{
        const html = await dbeChestFetchText('/bag');
        const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
        try{
          DBE_CHEST._backgroundBagSnapshotDoc = doc;
        }catch(_){}
        return doc;
      }catch(err){
        console.error('[DBE] failed to fetch /bag for verify:', err);
        return null;
      }
    }

    function dbeEnsureSortOutBusyLayerStyle(){
      try{
        if (document.getElementById('dbe-sortout-busy-layer-style')) return;
        const style = document.createElement('style');
        style.id = 'dbe-sortout-busy-layer-style';
        style.textContent = `
          #dbe-Dialog-ChestSortOutBusyLayer{
            position:fixed;
            inset:0;
            display:none;
            align-items:center;
            justify-content:center;
            background:rgba(0,0,0,0.42);
            color:#000;
            box-sizing:border-box;
          }
          #dbe-Dialog-ChestSortOutBusyLayer .dbe-sortout-busy-box{
            display:grid;
            gap:14px;
            justify-items:center;
            min-width:min(86vw, 320px);
            max-width:min(92vw, 520px);
            padding:22px 26px;
            border:6px solid #009300;
            border-radius:14px;
            background:#F6FFFF;
            box-shadow:
              0 10px 30px rgba(0,0,0,0.28),
              inset 0 0 0 3px rgba(153,0,0,0.16);
          }
          #dbe-Dialog-ChestSortOutBusyLayer .dbe-sortout-busy-spinner{
            width:46px;
            height:46px;
            border:6px solid #D7E8E8;
            border-top-color:#009300;
            border-radius:50%;
            animation:dbe-sortout-busy-spin 0.85s linear infinite;
          }
          #dbe-Dialog-ChestSortOutBusyLayer .dbe-sortout-busy-title{
            font-size:1.15em;
            font-weight:700;
            text-align:center;
          }
          #dbe-Dialog-ChestSortOutBusyLayer .dbe-sortout-busy-note{
            font-size:0.95em;
            line-height:1.5;
            text-align:center;
            color:#333;
          }
          @keyframes dbe-sortout-busy-spin{
            to{ transform:rotate(360deg); }
          }
        `;
        document.head.appendChild(style);
      }catch(err){
        console.warn('[DBE] failed to install sortout busy layer style:', err);
      }
    }

    function dbeShowSortOutBusyLayer(targetKind){
      try{
        dbeEnsureSortOutBusyLayerStyle();
        const layerID = 'dbe-Dialog-ChestSortOutBusyLayer';
        let layer = document.getElementById(layerID);
        if (!layer){
          layer = document.createElement('div');
          layer.id = layerID;
          layer.setAttribute('role', 'status');
          layer.setAttribute('aria-live', 'polite');
          layer.setAttribute('aria-busy', 'true');

          const box = document.createElement('div');
          box.className = 'dbe-sortout-busy-box';

          const spinner = document.createElement('div');
          spinner.className = 'dbe-sortout-busy-spinner';

          const title = document.createElement('div');
          title.className = 'dbe-sortout-busy-title';

          const note = document.createElement('div');
          note.className = 'dbe-sortout-busy-note';
          note.textContent = '処理が完了するまで、このままお待ちください。';

          box.append(spinner, title, note);
          layer.appendChild(box);
          document.body.appendChild(layer);
        }

        const title = layer.querySelector('.dbe-sortout-busy-title');
        if (title){
          title.textContent = targetKind === 'necklace'
            ? 'ネックレスを整理中です'
            : '武器防具を整理中です';
        }

        dbeBringDialogToFront(layer);
        layer.style.display = 'flex';
      }catch(err){
        console.warn('[DBE] failed to show sortout busy layer:', err);
      }
    }

    function dbeHideSortOutBusyLayer(){
      try{
        const layer = document.getElementById('dbe-Dialog-ChestSortOutBusyLayer');
        if (!layer) return;
        layer.style.display = 'none';
        layer.setAttribute('aria-busy', 'false');
        if (layer.dataset && layer.dataset.dbeFronted === '1'){
          delete layer.dataset.dbeFronted;
        }
      }catch(_){}
    }

    function dbeShowSortOutFinishedDialog(targetKind){
      try{
        const wnd = ensureWindowShell('dbe-Dialog-ChestSortOutFinished');
        wnd.classList.remove('dialogAlert', 'dialogAlertLite');
        wnd.classList.add('dialogCommon');
        Object.assign(wnd.style,{
          borderRadius:'10px',
          padding:'1em'
        });

        const closeBtn = wnd.firstElementChild;
        if (closeBtn && closeBtn.tagName === 'BUTTON'){
          closeBtn.style.display = 'none';
          closeBtn.disabled = true;
        }

        Array.from(wnd.children).forEach((ch, i)=>{
          if (i > 0) ch.remove();
        });

        const wrap = document.createElement('div');
        Object.assign(wrap.style,{
          display:'grid',
          gap:'12px',
          minWidth:'min(84vw, 320px)',
          maxWidth:'64ch',
          padding:'0.25em 0.5em'
        });

        const title = document.createElement('div');
        title.textContent = 'Finished:';
        Object.assign(title.style,{
          textAlign:'left',
          fontWeight:'700',
          fontSize:'1.05em'
        });

        const msg = document.createElement('div');
        msg.textContent = targetKind === 'necklace'
          ? 'ネックレスを整理しました。'
          : '武器防具を整理しました。';
        Object.assign(msg.style,{
          textAlign:'center',
          whiteSpace:'pre-wrap',
          wordBreak:'break-word',
          lineHeight:'1.6',
          fontSize:'1.05em',
          margin:'0.25em 0'
        });

        const ops = document.createElement('div');
        Object.assign(ops.style,{ textAlign:'center' });

        const btnReload = document.createElement('button');
        btnReload.type = 'button';
        btnReload.textContent = 'ページ再読み込み';
        Object.assign(btnReload.style,{
          cursor:'pointer',
          padding:'6px 20px',
          border:'2px solid #006600',
          borderRadius:'8px',
          background:'#E9FFE9',
          display:'inline-block',
          margin:'0.25em auto 0 auto'
        });
        btnReload.addEventListener('click', ()=>{
          try{ wnd.style.display = 'none'; }catch(_){}
          location.reload();
        });

        ops.appendChild(btnReload);
        wrap.append(title, msg, ops);
        wnd.appendChild(wrap);
        dbeBringDialogToFront(wnd);
        wnd.style.display = 'block';
        try{ setTimeout(()=>btnReload.focus(), 0); }catch(_){}
      }catch(err){
        console.error('[DBE] dbeShowSortOutFinishedDialog failed:', err);
        alert(targetKind === 'necklace'
          ? 'Finished:\nネックレスを整理しました。'
          : 'Finished:\n武器防具を整理しました。'
        );
      }
    }

    function dbePrepareSortOutDoc(doc, targetKind){
      try{
        if (!doc) return null;
        if (targetKind === 'necklace'){
          doc.getElementById('weaponTable')?.remove();
          doc.getElementById('armorTable')?.remove();
        } else {
          doc.getElementById('necklaceTable')?.remove();
        }
      }catch(_){}
      return doc;
    }

    async function dbeSortOutUnlockedBag(targetKind){
      if (DBE_CHEST.busy || DBE_CHEST._sortoutBusy){
        console.warn('[DBE] sortout already running');
        return;
      }

      DBE_CHEST._sortoutBusy = true;
      DBE_CHEST.busy = true;
      dbeShowSortOutBusyLayer(targetKind);
      DBE_CHEST.qLock = [];
      DBE_CHEST.qRecycle = [];
      DBE_CHEST.qUnlock = [];
      DBE_CHEST.stage = targetKind === 'necklace' ? 'sortout_necklace' : 'sortout_weapon_armor';
      DBE_CHEST.type = targetKind === 'necklace' ? 'battle_normal' : 'normal';
      DBE_CHEST.didWork = true;
      DBE_CHEST.onlyNew = false;
      DBE_CHEST.recycleUnlockedBulk = false;
      DBE_CHEST.unlimited = false;
      DBE_CHEST.left = 0;
      DBE_CHEST.liveDom = false;
      DBE_CHEST.backgroundBagTables = true;
      DBE_CHEST.onHoldIds = new Set();
      DBE_CHEST._serverError = false;
      DBE_CHEST._userAbort = false;
      DBE_CHEST._directActionBusy = false;
      DBE_CHEST._backgroundBagSnapshotDoc = null;
      // v12.1.0.1:
      // 「アイテムバッグを整理する」は新規取得差分ではなく、バッグ内の未ロック装備そのものを対象にする。
      // ただし buildLockQueuesAfterOpen() は preSet を参照するため、対象種別を含めて必ず初期化する。
      DBE_CHEST.pre = {
        wep: new Set(),
        amr: new Set(),
        nec: new Set()
      };

      try{
        try{ loadRulesFromStorage(); }catch(_){}

        let bagDoc = await dbeChestFetchBagDocForVerify();
        if (!bagDoc){
          dbeChestShowQueueAbortDialog('アイテムバッグの取得に失敗したため、整理処理を中断しました。');
          return;
        }

        bagDoc = dbePrepareSortOutDoc(bagDoc, targetKind);

        // buildLockQueuesAfterOpen() は渡された doc の中だけを走査する。
        // そのため /bag を背景取得した DOMParser 文書を渡し、実ページDOMは直接編集しない。
        buildLockQueuesAfterOpen(bagDoc);

        const lockOk = await dbeChestRunLockQueueDirect();
        if (!lockOk) return;

        const recycleOk = await dbeChestRunRecycleQueueDirect();
        if (!recycleOk) return;

        dbeHideSortOutBusyLayer();
        dbeShowSortOutFinishedDialog(targetKind);
      }catch(err){
        console.error('[DBE] dbeSortOutUnlockedBag failed:', err);
        dbeChestShowQueueAbortDialog('アイテムバッグ整理処理に異常が発生したためプロセスを中断しました。');
      }finally{
        dbeHideSortOutBusyLayer();
        DBE_CHEST._sortoutBusy = false;
        DBE_CHEST.busy = false;
        DBE_CHEST.stage = 'idle';
        DBE_CHEST.liveDom = true;
        DBE_CHEST.backgroundBagTables = false;
        DBE_CHEST._directActionBusy = false;
        DBE_CHEST.onHoldIds = new Set();
        DBE_CHEST.didWork = false;
      }
    }

    function dbeChestFindRowByItemId(doc, itemId){
      try{
        const id = String(itemId || '').trim();
        if (!doc || !id) return null;
        const tables = ['#necklaceTable', '#weaponTable', '#armorTable'];
        for (const sel of tables){
          const table = doc.querySelector(sel);
          const body = table && table.tBodies && table.tBodies[0];
          if (!body) continue;
          for (const tr of Array.from(body.rows || [])){
            const a = tr.querySelector('a[href*="/equip/"]');
            const found = a && String(a.getAttribute('href') || a.href || '').match(/\/equip\/(\d+)/)?.[1];
            if (found === id) return tr;
          }
        }
      }catch(_){}
      return null;
    }

    function dbeChestIsLockedInBagDoc(doc, itemId){
      try{
        const tr = dbeChestFindRowByItemId(doc, itemId);
        if (!tr) return false;
        const table = tr.closest('table');
        const map = table ? headerMap(table) : {};
        const iLock = map['解'];
        if (iLock == null || iLock < 0 || !tr.cells[iLock]) return false;
        const a = tr.cells[iLock].querySelector('a[href]');
        const href = String(a && (a.getAttribute('href') || a.href) || '');
        return href.includes('/unlock/');
      }catch(_){
        return false;
      }
    }

    function dbeChestItemExistsInBagDoc(doc, itemId){
      return !!dbeChestFindRowByItemId(doc, itemId);
    }

    function dbeChestShowQueueAbortDialog(messageText){
      try{
        DBE_CHEST._serverError = true;
        DBE_CHEST._userAbort = true;
        DBE_CHEST.left = 0;
        DBE_CHEST.unlimited = false;
        DBE_CHEST.qLock = [];
        DBE_CHEST.qRecycle = [];
        DBE_CHEST._pendingBgAction = null;
        DBE_CHEST._pendingBgActionId = null;
        DBE_CHEST.stage = 'idle';
        DBE_CHEST.busy = false;
        DBE_CHEST._autoRunning = false;
        clearInterval(DBE_CHEST._progressTimer);
        DBE_CHEST._progressTimer = null;
        try{ stopProgressHud(); }catch(_){}
        try{ window.DBE_FinishProgressUI?.(); }catch(_){}
      }catch(_){}

      try{
        const wnd = ensureWindowShell('dbe-Dialog-ChestQueueError');
        wnd.classList.remove('dialogCommon');
        wnd.classList.add('dialogAlert');
        Object.assign(wnd.style, {
          borderRadius: '10px',
          padding: '1em'
        });

        const closeBtn = wnd.firstElementChild;
        if (closeBtn && closeBtn.tagName === 'BUTTON'){
          closeBtn.style.display = 'none';
          closeBtn.disabled = true;
        }

        Array.from(wnd.children).forEach((ch, i)=>{
          if (i > 0) ch.remove();
        });

        const wrap = document.createElement('div');
        Object.assign(wrap.style, {
          display: 'grid',
          gap: '12px',
          minWidth: 'min(84vw, 360px)',
          maxWidth: '64ch',
          padding: '0.25em 0.5em'
        });

        const title = document.createElement('div');
        title.textContent = 'Error:';
        Object.assign(title.style, {
          textAlign: 'left',
          fontWeight: '700',
          fontSize: '1.05em'
        });

        const msg = document.createElement('div');
        msg.textContent = String(messageText || '');
        Object.assign(msg.style, {
          textAlign: 'center',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          lineHeight: '1.6',
          fontSize: '1.05em',
          margin: '0.25em 0'
        });

        const ops = document.createElement('div');
        Object.assign(ops.style, {
          textAlign: 'center'
        });

        const btn = document.createElement('button');
        btn.textContent = 'ページを再読み込みする';
        Object.assign(btn.style, {
          cursor: 'pointer',
          padding: '6px 20px',
          border: '2px solid #930000',
          borderRadius: '8px',
          background: '#FFE9E9',
          display: 'inline-block',
          margin: '0.25em auto 0 auto'
        });
        btn.addEventListener('click', ()=>{
          try{
            if (window.__DBE_RELOAD_GUARD && typeof window.__DBE_RELOAD_GUARD.disable === 'function'){
              window.__DBE_RELOAD_GUARD.disable({ executePending:false });
            }
          }catch(_){}
          location.reload();
        });

        ops.appendChild(btn);
        wrap.append(title, msg, ops);
        wnd.appendChild(wrap);
        dbeBringDialogToFront(wnd);
        wnd.style.display = 'block';
        try{ setTimeout(()=>btn.focus(), 0); }catch(_){}
      }catch(err){
        console.error('[DBE] dbeChestShowQueueAbortDialog failed:', err);
        alert('Error:\n' + String(messageText || '処理に異常が発生したためプロセスを中断しました。'));
      }
    }

    async function dbeChestRunLockQueueDirect(){
      const ids = dbeChestNormalizeQueueItemIds(DBE_CHEST.qLock);
      DBE_CHEST.qLock = ids.map(id=>({ id }));
      if (!ids.length) return true;

      let remain = ids.slice();
      for (let attempt = 1; attempt <= 3; attempt++){
        await dbeChestSendActionQueueOnce('lock', remain);

        {
          const timing = dbeReadChestActionTiming();
          await new Promise(resolve=>setTimeout(resolve, Math.max(0, Number(timing.waitMs) || 0)));
        }

        const bagDoc = await dbeChestFetchBagDocForVerify();
        if (!bagDoc){
          remain = remain.slice();
        } else {
          remain = remain.filter(id=>!dbeChestIsLockedInBagDoc(bagDoc, id));
        }

        DBE_CHEST.qLock = remain.map(id=>({ id }));
        if (!remain.length){
          DBE_CHEST.qLock = [];
          return true;
        }
      }

      dbeChestShowQueueAbortDialog('ロック処理に異常が発生したためプロセスを中断しました。');
      return false;
    }

    async function dbeChestRunRecycleQueueDirect(){
      const ids = dbeChestNormalizeQueueItemIds(DBE_CHEST.qRecycle);
      DBE_CHEST.qRecycle = ids.map(id=>({ id }));
      if (!ids.length) return true;

      let remain = ids.slice();
      for (let attempt = 1; attempt <= 3; attempt++){
        await dbeChestSendActionQueueOnce('recycle', remain);

        {
          const timing = dbeReadChestActionTiming();
          await new Promise(resolve=>setTimeout(resolve, Math.max(0, Number(timing.waitMs) || 0)));
        }

        const bagDoc = await dbeChestFetchBagDocForVerify();
        if (!bagDoc){
          remain = remain.slice();
        } else {
          remain = remain.filter(id=>dbeChestItemExistsInBagDoc(bagDoc, id));
        }

        DBE_CHEST.qRecycle = remain.map(id=>({ id }));
        if (!remain.length){
          DBE_CHEST.qRecycle = [];
          return true;
        }
      }

      dbeChestShowQueueAbortDialog('分解処理に異常が発生したためプロセスを中断しました。');
      return false;
    }

    async function dbeChestRunRecycleUnlockedBulkDirect(){
      // 宝箱／バトル宝箱の開封選別フロー専用。
      // 「アイテムバッグを整理する」側では DBE_CHEST.recycleUnlockedBulk=false に固定し、
      // 従来どおり /recycle による個別分解を維持する。
      if (!DBE_CHEST.recycleUnlockedBulk) return true;

      try{
        const timing = dbeReadChestActionTiming();
        await new Promise(resolve=>setTimeout(resolve, Math.max(0, Number(timing.waitMs) || 0)));

        await fetch(`${DBE_ORIGIN}/recycleunlocked`, {
          method:'POST',
          credentials:'same-origin',
          cache:'no-store',
          redirect:'follow',
          headers:{
            'Accept':'text/html, text/plain, */*',
            'X-Requested-With':'XMLHttpRequest'
          }
        });

        const bagDoc = await dbeChestFetchBagDocForVerify();
        if (bagDoc){
          try{
            DBE_CHEST._backgroundBagSnapshotDoc = bagDoc;
          }catch(_){}
        }

        return true;
      }catch(err){
        console.error('[DBE] dbeChestRunRecycleUnlockedBulkDirect failed:', err);
        dbeChestShowQueueAbortDialog('未ロック装備の一括分解処理に異常が発生したためプロセスを中断しました。');
        return false;
      }
    }

    async function dbeChestRunActionQueuesDirectThenContinue(startDoc){
      // v12.0.1.14:
      // /lock / /recycle は iframe link.click() を使わず、直接 fetch で送信する。
      // 各キューを全送信 → /bag 再取得で検証 → 未反映だけ最大2回再送。
      if (DBE_CHEST._directActionBusy) return;
      DBE_CHEST._directActionBusy = true;
      try{
        DBE_CHEST.stage = 'locking';
        const lockOk = await dbeChestRunLockQueueDirect();
        if (!lockOk) return;

        DBE_CHEST.stage = 'recycling';
        const recycleOk = DBE_CHEST.recycleUnlockedBulk
          ? await dbeChestRunRecycleUnlockedBulkDirect()
          : await dbeChestRunRecycleQueueDirect();
        if (!recycleOk) return;

        DBE_CHEST.stage = 'after_actions';
        const workDoc = DBE_CHEST._backgroundBagSnapshotDoc || startDoc || DBE_CHEST.iframe?.contentDocument || document;
        afterIterationStep(workDoc);
      }catch(err){
        console.error('[DBE] dbeChestRunActionQueuesDirectThenContinue error:', err);
        dbeChestShowQueueAbortDialog('ロック／分解処理に異常が発生したためプロセスを中断しました。');
      }finally{
        DBE_CHEST._directActionBusy = false;
      }
    }

    // 〓〓〓 ロックキューを逐次実行（ライブDOM対応） 〓〓〓
    function scheduleNextLock(){
      // v12.0.1.14:
      // link.click() と iframe load 監視には依存しない。
      // /lock キューを直接サーバーへ送信し、/bag 取得でロック確認を行う。
      try{
        const workDoc = DBE_CHEST.backgroundBagTables
          ? (DBE_CHEST.iframe?.contentDocument)
          : (DBE_CHEST.liveDom ? document : (DBE_CHEST.iframe?.contentDocument));
        dbeChestRunActionQueuesDirectThenContinue(workDoc);
      }catch(err){
        console.error('[DBE] scheduleNextLock direct error:', err);
        dbeChestShowQueueAbortDialog('ロック処理に異常が発生したためプロセスを中断しました。');
      }
    }

    // 〓〓〓 分解キューを逐次実行（ライブDOM対応） 〓〓〓
    function scheduleNextRecycle(){
      // v12.0.1.14:
      // /lock キューが空になった後、/recycle キューを直接サーバーへ送信し、
      // /bag 取得で「対象IDが消えていること」を確認する。
      try{
        const workDoc = DBE_CHEST.backgroundBagTables
          ? (DBE_CHEST.iframe?.contentDocument)
          : (DBE_CHEST.liveDom ? document : (DBE_CHEST.iframe?.contentDocument));
        dbeChestRunActionQueuesDirectThenContinue(workDoc);
      }catch(err){
        console.error('[DBE] scheduleNextRecycle direct error:', err);
        dbeChestShowQueueAbortDialog('分解処理に異常が発生したためプロセスを中断しました。');
      }
    }

    // 〓〓〓 1ループ完了後：次のループ or 最終解除 〓〓〓
    function afterIterationStep(doc){
      // v12.0.1.11:
      // backgroundBagTables=true の間は実ページ側 /bag テーブルを更新しないため、
      // 次回開封の差分取得に使う「開封前 /bag」を iframe 側の最新DOMから保存する。
      // これにより、1回目→2回目→3回目…の各開封で、
      // dbe-W-ChestProgress の新規取得ログが毎回更新される。
      try{
        if (DBE_CHEST.backgroundBagTables && doc && /\/bag(?:$|[?#])/.test(String(doc.location?.href || ''))){
          DBE_CHEST._backgroundBagSnapshotDoc = dbeChestCloneDocTablesForLootDiff(doc, DBE_CHEST.type);
        }
      }catch(_){}

      // onhold のロック/解錠運用は廃止。onhold 付与済みは常に「保留」扱いとし、ここでは何もしない。
      // ユーザーが「中断する」を押していたら、次の宝箱を開ける段階で停止する
      // （= 現在ループのフィルタカード適用／ロック／分解は完了済みの想定）
      if (DBE_CHEST._userAbort){
        (window.DBE_finishChest ? window.DBE_finishChest() : finishChest());
        return;
      }
      if (DBE_CHEST.unlimited || --DBE_CHEST.left > 0){
        // 次ループ：/chest or /battlechest を fetch で取得して開封POSTへ進む
        DBE_CHEST.qLock = [];
        DBE_CHEST.stage = 'load_chest';
        dbeFetchChestPageAndOpen(DBE_CHEST.type);
        try{ tickProgressHud(); }catch(_){}
      }else{
        // 最終：onhold 解除フェーズは廃止 → 直接終了
        (window.DBE_finishChest ? window.DBE_finishChest() : finishChest());
      }
    }

    // 〓〓〓 最終解除用キューを組み立て（/unlock/ をクリック） 〓〓〓
    function buildUnlockQueueFromIframe(doc){
      DBE_CHEST.qUnlock = [];
      const onHoldId = DBE_CHEST.onHoldIds || new Set();
      const pushFrom = (sel)=>{
        const table = doc.querySelector(sel);
        if (!table || !table.tBodies[0]) return;
        const map = headerMap(table);
        const iEqup = map['装'], iLock = map['解'];
        if (iEqup<0 || iLock<0) return;
        Array.from(table.tBodies[0].rows).forEach(tr=>{
          const a = tr.cells[iEqup]?.querySelector('a[href*="/equip/"]');
          const id = a?.href?.match(/\/equip\/(\d+)/)?.[1];
          if (!id || !onHoldId.has(id)) return;
          const cand = tr.cells[iLock]?.querySelector('a[href]');
          const href = String(cand?.getAttribute('href')||'');
          if (href.includes('/unlock/')){
            const kind = sel==='#weaponTable'?'wep':(sel==='#armorTable'?'amr':'nec');
            DBE_CHEST.qUnlock.push({table:kind, id});
          }
        });
      };
      ['#weaponTable','#armorTable','#necklaceTable'].forEach(pushFrom);
      console.log('[DBE] unlock-queue=', DBE_CHEST.qUnlock);
    }

    // ── 解除キューを逐次実行 ──
    function scheduleNextUnlock(){
      if (DBE_CHEST.qUnlock.length===0){ finishChest(); return; }
      const delay = DBE_CHEST.delay ? DBE_CHEST.delay() : 300;
      setTimeout(()=>{
        try{
          const fr = DBE_CHEST.iframe;
          const doc = fr?.contentDocument;
          if (!doc){ finishChest(); return; }
          const task = DBE_CHEST.qUnlock.shift();
          const table = doc.querySelector(task.table==='wep' ? '#weaponTable' : (task.table==='amr' ? '#armorTable' : '#necklaceTable'));
          if (!table || !table.tBodies[0]){ scheduleNextUnlock(); return; }
          const map = headerMap(table);
          const iEqup = map['装'], iLock = map['解'];
          let link=null;
          outer: for (const tr of Array.from(table.tBodies[0].rows)){
            const a = tr.cells[iEqup]?.querySelector('a[href*="/equip/"]');
            const id = a?.href?.match(/\/equip\/(\d+)/)?.[1];
            if (id===task.id){
              const cand = tr.cells[iLock]?.querySelector('a[href]');
              const href = String(cand?.getAttribute('href')||'');
              if (href.includes('/unlock/')) link = cand;
              break outer;
            }
          }
          // 「解錠」クリック直前にウェイトを入れる
          {
            const d = (typeof DBE_CHEST.delay === 'function') ? DBE_CHEST.delay() : 300;
            setTimeout(()=>{
              if (link){
                link.click();
              } else {
                console.warn('[DBE] lock link not found for', task);
                scheduleNextLock();
              }
            }, d);
          }          // クリック後は onBgFrameLoad 経由で /bag が再読込 → stage:'unlocking' のまま戻る
        }catch(err){
          console.error('[DBE] scheduleNextUnlock error:', err);
          finishChest();
        }
      }, delay);
    }

    function closeRulesModal(){
      const overlay = document.getElementById('dbe-modal-overlay');
      const wnd = document.getElementById('dbe-W-Rules');
      if (wnd) wnd.style.display='none';
      if (overlay) overlay.style.display='none';
      document.body.style.overflow='';
    }
    function reopenChest(){
      const wnd = document.getElementById('dbe-W-Chest') || ensureWindowShell('dbe-W-Chest');
      if (wnd.children.length <= 1) wnd.appendChild(buildChestWindow());
      wnd.style.display='inline-block';
    }

    // 〓〓〓 フォーム部品ヘルパ（最小実装） 〓〓〓
    function rowRadio(name, pairs, required){
      const node=document.createElement('div'); Object.assign(node.style,{display:'flex',gap:'10px',alignItems:'center',flexWrap:'wrap'});
      const group='grp-'+name+'-'+Math.random().toString(36).slice(2);
      let val=null;
      pairs.forEach(([v,l])=>{
        const r=document.createElement('input'); r.type='radio'; r.name=group; r.value=v;
        const lb=document.createElement('label'); lb.append(r, document.createTextNode(' '+l));
        r.addEventListener('change',()=>{ val=v; });
        node.append(lb);
      });
      return {node, value:()=>val};
    }
    function rowSelect(id, options){
      const node=document.createElement('div');
      const sel=document.createElement('select'); if (id) sel.id=id;
      options.forEach(o=>{ const op=document.createElement('option'); op.value=o; op.textContent=o; sel.append(op); });
      node.append(sel); return {node, select:sel, value:()=>sel.value};
    }
    function rowCheck(id, label){
      const node=document.createElement('div');
      const c=document.createElement('input'); c.type='checkbox'; c.id=id;
      const lb=document.createElement('label'); lb.htmlFor=id; lb.append(document.createTextNode(' '+label));
      node.append(c, lb); return {node, value:()=>c.checked};
    }
    function rowCompare(idNum, labelText, idSel, opts){
      const node=document.createElement('div'); Object.assign(node.style,{display:'flex',gap:'8px',alignItems:'center',flexWrap:'wrap'});
      const lab=document.createElement('span'); lab.textContent=labelText;
      const num=document.createElement('input'); num.type='number'; num.step='0.1'; num.id=idNum; Object.assign(num.style,{fontSize:'0.9em',width:'3em',padding:'2px 8px'});
      const sel=rowSelect(idSel, opts);
      node.append(lab, num, sel.node);
      return {node, data:()=>({value:num.value, border:sel.value()}), label:()=> (sel.value()&&sel.value()!=='選択してください'&&num.value!==''?`${labelText}:${num.value}${sel.value()}`:'' )};
    }
    function rowRadioText(name, pairs, hint){
      const node=document.createElement('div'); Object.assign(node.style,{display:'grid',gap:'6px'});
      const group='grp-'+name+'-'+Math.random().toString(36).slice(2);
      let mode=null;
      const line=document.createElement('div'); Object.assign(line.style,{display:'flex',gap:'12px',flexWrap:'wrap',alignItems:'center'});
      pairs.forEach(([v,l])=>{
        const r=document.createElement('input'); r.type='radio'; r.name=group; r.value=v;
        const lb=document.createElement('label'); lb.append(r, document.createTextNode(' '+l));
        r.addEventListener('change',()=>{ mode=v; ta.disabled=(v!=='spec'); });
        line.append(lb);
      });
      const ta=document.createElement('textarea'); Object.assign(ta.style,{fontSize:'0.9em',padding:'2px 8px',width:'min(72svw,560px)'});
        ta.disabled = true; // 初期は未選択→入力不可
        node.append(line, ta);
        if (hint) {
          const hintEl=document.createElement('div');
          Object.assign(hintEl.style,{fontSize:'0.85em',opacity:'0.8'});
          hintEl.textContent=hint;
          node.append(hintEl);
        }
      function valid(){
        if (mode==='spec'){
          const text=ta.value.trim();
          if (!text) { alert('キーワードを入力してください。'); return false; }
            // 区切りは半角/全角「;」を許可。連続数は不問。
            // 例: "A;B；C;;；；D" → ["A","B","C","D"]
        }
        if (!mode){ alert('「不問」または「指定」を選択してください。'); return false; }
        return true;
      }
      // 半角/全角セミコロンの連続を1つの区切りに正規化し、前後空白を除去して「；」で結合
      const normalize = (s)=>
        s.split(/[;；]+/).map(t=>t.trim()).filter(Boolean).join('；');
      return {
        node, valid,
        data:()=>({
          mode,
          keywords: normalize(ta.value.trim())
        }),
        label:()=> (mode==='all' ? '不問' : `指定:${normalize(ta.value)}`)
      };
    }
    function rowElmChecks(baseId){
      const node=document.createElement('div'); Object.assign(node.style,{display:'flex',gap:'10px',alignItems:'center',flexWrap:'wrap'});
      const names=['不問','||','火','氷','雷','風','地','水','光','闇','なし'];
      const boxes=[];
      names.forEach(n=>{
        if (n==='||'){ const sep=document.createElement('span'); sep.textContent='||'; node.append(sep); return; }
        const id = baseId+'-'+n;
        const c=document.createElement('input'); c.type='checkbox'; c.id=id;
        const lb=document.createElement('label'); lb.htmlFor=id; lb.append(document.createTextNode(' '+n));
        boxes.push({n,c}); node.append(c,lb);
      });
      const all = boxes.find(b=>b.n==='不問').c;
      const rests = boxes.filter(b=>b.n!=='不問');
      const sync = ()=>{
        if (all.checked){ rests.forEach(({c})=>{ c.checked=true; c.disabled=true; }); }
        else { rests.forEach(({c})=>{ c.disabled=false; }); }
      };
      all.addEventListener('change', sync);
      const data = ()=>({
        all: all.checked,
        selected: rests.filter(({c})=>c.checked).map(({n})=>n) // ← 選択された属性ラベルを配列で保持
      });
      const label = ()=>{
        const picked = rests.filter(({c})=>c.checked).length;
        rreturn (all.checked || rests.every(({c})=>c.checked)) ? '不問' : `属性${picked}種`;
      };
      return {node, data, label};
    }
    function rowCompareText(idTxt, labelText, idSel, opts, width){
      const node=document.createElement('div'); Object.assign(node.style,{display:'flex',gap:'8px',alignItems:'center',flexWrap:'wrap'});
      const txt=document.createElement('input'); txt.type='text'; txt.id=idTxt; Object.assign(txt.style,{fontSize:'0.9em',width:width||'10em',padding:'2px 8px'});
      const lab=document.createElement('span'); lab.textContent=labelText;
      const sel=rowSelect(idSel, opts);
      node.append(txt, lab, sel.node);
      return {node, data:()=>({text:txt.value,border:sel.value()}), label:()=> (sel.value()&&sel.value()!=='選択してください'&&txt.value!==''?`${labelText}:${txt.value}${sel.value()}`:'')};
    }

    // ★ 新規カード作成用「決定／初期化」ボタン作成ヘルパ（完全版）
    function makeDecideReset(onDecide, onReset){
      const node = document.createElement('div');
      Object.assign(node.style, {
        display: 'flex',
        gap: '8px',
        alignItems: 'center',
        marginTop: '6px',
        flexWrap: 'wrap'
      });
      const btnOk  = document.createElement('button');
      const btnClr = document.createElement('button');
      btnOk.textContent  = '決定';
      btnClr.textContent = '初期化';
      [btnOk, btnClr].forEach(b=>{
        b.type = 'button';
        b.style.padding = '4px 12px';
        b.style.border = '1px solid #666';
        b.style.background = '#fff';
        b.style.borderRadius = '6px';
        b.style.cursor = 'pointer';
      });
      if (typeof onDecide === 'function') {
        btnOk.addEventListener('click', (ev)=>{
          ev.preventDefault();
          ev.stopPropagation();
          onDecide();
        });
      }
      if (typeof onReset === 'function') {
        btnClr.addEventListener('click', (ev)=>{
          ev.preventDefault();
          ev.stopPropagation();
          onReset();
        });
      }
      node.append(btnClr, btnOk);
      return node;
    }
  }
  // ============================================================
  // △ここまで△ "dbe-MenuBar"のコンテナとボタン群の生成ロジック
  // ============================================================

  // 〓〓〓 dbe-W-Rules（モーダル）〓〓〓
  // 選別フィルタの保持領域（ネックレス／武器／防具）
  let _rulesData = { nec:[], wep:[], amr:[] };

  // ============================================================
  // ▽ここから▽ 新フォーム（《フィルタカード》新規作成フォーム）モーダル内容を構築
  // ============================================================
  function buildNewFilterModalContent(){
    // 新フォーム専用のモーダル内容を、単一スコープ内で完結して構築する。
    // 変数は「宣言 → 参照」の順序に統一し、同名の関数/変数衝突を廃止。

    // === 保存完了ダイアログ：表示・クローズ（window に共通化） ===
    // タブ切替等で buildNewFilterModalContent が再実行されても同じ関数を使う
    if (typeof window.__dbeShowSavedDialog !== 'function'){
      window.__dbeShowSavedDialog = function __dbeShowSavedDialog(){
      // 既に存在すればタイマーだけ更新
      let overlay = document.getElementById('dbe-save-overlay');
      if (!overlay){
        overlay = document.createElement('div');
        overlay.id = 'dbe-save-overlay';
        overlay.className = 'dbe-save-overlay';
        overlay.innerHTML = (
            '<div class="dbe-save-dialog dialogCommon" role="dialog" aria-modal="true" aria-labelledby="dbe-save-title">'+
            '<div id="dbe-save-title" class="dbe-save-title">保存しました</div>'+
            '<div style="font-size:.95em;color:#555;">編集内容は保存されました。</div>'+
            '<div class="dbe-save-actions"><button type="button" id="dbe-save-ok">OK</button></div>'+
          '</div>'
        );
        document.body.appendChild(overlay);
        overlay.querySelector('#dbe-save-ok').addEventListener('click', window.__dbeCloseSavedDialog);
        // Escキーでも閉じる
        overlay.addEventListener('keydown', function(ev){ if (ev.key==='Escape') window.__dbeCloseSavedDialog(); });
        // フォーカスをOKへ
        setTimeout(()=> overlay.querySelector('#dbe-save-ok')?.focus(), 0);
      }
      // 参照枠（dbe-W-Rules）から枠線スタイルを引き継ぐ
      try{
        const ref = document.getElementById('dbe-W-Rules');
        const dlg = overlay.querySelector('.dbe-save-dialog');
        if (ref && dlg){
          const cs = getComputedStyle(ref);
          const c  = cs.borderTopColor || cs.outlineColor || '#aaa';
          const wnd  = cs.borderTopWidth || '1px';
          const st = cs.borderTopStyle || 'solid';
          const r  = cs.borderTopLeftRadius || '10px';
          dlg.style.setProperty('--dbe-frame-color',  c);
          dlg.style.setProperty('--dbe-frame-width',  wnd);
          dlg.style.setProperty('--dbe-frame-style',  st);
          dlg.style.setProperty('--dbe-frame-radius', r);
        }
      }catch(_){}
      // すでにあっても最前面へ（末尾に付け直し & 念のため z-index を直指定）
      try{
        document.body.appendChild(overlay); // 末尾へ移動＝前面化
        overlay.style.zIndex = '2147483647';
      }catch(_){}
      // 10秒で自動クローズ（再表示時は延長）
      clearTimeout(overlay.__dbe_timer);
      overlay.__dbe_timer = setTimeout(window.__dbeCloseSavedDialog, 10000);
      };
    }
    if (typeof window.__dbeCloseSavedDialog !== 'function'){
      window.__dbeCloseSavedDialog = function __dbeCloseSavedDialog(){
      const overlay = document.getElementById('dbe-save-overlay');
      if (!overlay) return;
      clearTimeout(overlay.__dbe_timer);
      overlay.remove();
      };
    }

    // === 保存フック：saveRulesToStorage をラップ（あれば）。後から生えるケースがあるのでリトライする。
    //     ※ 「保存しました」ダイアログは “実際に saveRulesToStorage が成功した時” かつ
    //        “ユーザーが直前に「保存する」を押した意図がある時” のみに限定して誤表示を防ぐ
    (function __dbeInstallSaveHook(){
      // 多重インストール防止
      if (window.__DBE_SAVE_HOOK_INSTALLED) return;
      window.__DBE_SAVE_HOOK_INSTALLED = true;

      // 「保存する」クリック意図（短時間だけ有効）
      try{
        if (!window.__DBE_SAVE_INTENT_WATCH_INSTALLED){
          window.__DBE_SAVE_INTENT_WATCH_INSTALLED = true;
          window.__DBE_SAVE_DIALOG_INTENT = false;
          window.__DBE_SAVE_DIALOG_BLOCK_ONCE = false;
          window.__DBE_SAVE_INTENT_TIMER = null;
          document.addEventListener('click', function(ev){
            try{
              if (!ev || !ev.isTrusted) return;
              const btn = ev.target && ev.target.closest && ev.target.closest('button, input[type="button"], input[type="submit"]');
              if (!btn) return;
              const txt = ((btn.tagName === 'INPUT' ? (btn.value || '') : (btn.textContent || ''))).trim();
              // 「保存する」/「保存」クリック意図（短時間だけ有効）
              if (txt !== '保存する' && txt !== '保存') return;
              if (!btn.closest) return;
              // 対象領域：
              // - ルール一覧ウィンドウ（dbe-W-Rules）
              // - 再編集ウィンドウ（dbe-W-RuleEdit）
              // - フィルタカード ビルダー/エディター（filtercard-builder/editor）
              const inRules   = !!btn.closest('#dbe-W-Rules');
              const inEditWnd = !!btn.closest('#dbe-W-RuleEdit');
              const inBuilder = !!btn.closest('#filtercard-builder');
              const inEditor  = !!btn.closest('#filtercard-editor');
              if (!inRules && !inEditWnd && !inBuilder && !inEditor) return;

              window.__DBE_SAVE_DIALOG_INTENT = true;
              // 2秒で自動解除（タブ切替などの別トリガー誤表示防止）
              clearTimeout(window.__DBE_SAVE_INTENT_TIMER);
              window.__DBE_SAVE_INTENT_TIMER = setTimeout(function(){
                try{ window.__DBE_SAVE_DIALOG_INTENT = false; }catch(_){}
              }, 2000);
            }catch(_){}
          }, true);
        }
      }catch(_){}

      function onSaved(){
        try{
          // 安全弁などで「保存禁止」を出した直後は、保存完了表示を1回だけ抑止
          if (window.__DBE_SAVE_DIALOG_BLOCK_ONCE){
            window.__DBE_SAVE_DIALOG_BLOCK_ONCE = false;
            return;
          }
          // 直前にユーザーが「保存する」を押した時だけ出す
          if (!window.__DBE_SAVE_DIALOG_INTENT) return;
          window.__DBE_SAVE_DIALOG_INTENT = false;
        }catch(_){}
        try{ __dbeShowSavedDialog(); }catch(_){}
      }

      function tryWrap(){
        let ok = false;
        try{
          // 重要：window 経由だけでなく、同名の関数宣言バインディング（saveRulesToStorage）もラップする
          const hasWin = (typeof window.saveRulesToStorage === 'function');
          const hasLex = (typeof saveRulesToStorage === 'function');

          const winFn = hasWin ? window.saveRulesToStorage : null;
          const lexFn = hasLex ? saveRulesToStorage : null;

          const alreadyWrapped = (fn)=> !!(fn && fn.__dbeWrapped);

          // ラップ対象を決定（どちらかが未ラップならラップする）
          let targetOrig = null;
          if (hasLex && !alreadyWrapped(lexFn)){
            targetOrig = lexFn;
          }else if (hasWin && !alreadyWrapped(winFn)){
            targetOrig = winFn;
          }

          if (targetOrig){
            const orig = targetOrig;
            const wrappedFn = function(){
              try{
                const ret = orig.apply(this, arguments);
                // Promise/同期の両対応：成功時だけ表示
                Promise.resolve(ret).then(onSaved).catch(()=>{});
                return ret;
              }catch(_e){
                throw _e;
              }
            };
            wrappedFn.__dbeWrapped = true;

            // 両方に反映（存在する側だけ）
            try{ if (hasWin) window.saveRulesToStorage = wrappedFn; }catch(_){}
            try{ if (hasLex) saveRulesToStorage = wrappedFn; }catch(_){}

            ok = true;
          }else{
            // 両方とも存在し、かつラップ済みならOK扱い
            if ((hasWin && alreadyWrapped(winFn)) || (hasLex && alreadyWrapped(lexFn))){
              ok = true;
            }
          }
        }catch(_){}
        return ok;
      }

      // まず即時トライ
      if (tryWrap()) return;

      // 後から定義されるケースに備えて短時間リトライ（※フォールバックの click 監視で「保存完了」を出すのは禁止）
      let tries = 0;
      const maxTries = 50;      // 200ms * 50 = 約10秒
      const interval = 200;
      const timer = setInterval(function(){
        tries++;
        if (tryWrap()){
          clearInterval(timer);
          return;
        }
        if (tries >= maxTries){
          clearInterval(timer);
          // ここではフォールバック表示は行わない（誤表示の温床になるため）
        }
      }, interval);
    })()

    // ラッパ（モーダルの body に入る中身）
    const wrap = document.createElement('div');
    wrap.className = 'dbe-window-body';

    // 見出し
    const titleEl = document.createElement('div');
    titleEl.textContent = '装備の選別フィルタ';
    Object.assign(titleEl.style, { fontSize:'1.2em', fontWeight:'bold' });

    // 注意書き（アコーディオン：details/summary）
    const noteEl = document.createElement('div');
    noteEl.innerHTML = `
      <details id="dbe-rules-note" class="dbe-acc">
        <summary>注意事項（クリックして展開）</summary>
        <div class="dbe-acc-body">
          <ul style="font-size:0.9em; margin:6px 0 0 1.2em; padding:0;">
            <li>フィルタカードを編集したら忘れず保存してください。保存しなかった情報は破棄されます。</li>
            <li>「保存する」ボタンは《動作モード（ロック／分解）》の区別なく、すべてのフィルタカード情報を保存します。</li>
            <li>《動作モード》の選択に加え、各項目の設定が必須です。各項目について、「すべて」や「不問」を選ぶか、具体的な条件を入力・選択してください。未設定の項目がある場合はカードを追加できません。</li>
            <li>「不問」に設定された条件は装備の選別において判定がスキップされます。</li>
            <li>異常が生じた場合は「全データを消去」実施により改善する可能性があります。（その際、すべてのフィルタカードが消去されます。あらかじめご了承ください。）</li>
            <li>いかなる不利益が生じても補償等はできません。“永遠のβバージョン”と思ってください。</li>
          </ul>
        </div>
      </details>
    `;
    // （任意）開閉状態の永続化
    try{
      const NOTE_OPEN_KEY = 'dbe-rules-note-open';
      const det = noteEl.querySelector('#dbe-rules-note');
      if (dbeStorage.getItem(NOTE_OPEN_KEY) === 'true') det.setAttribute('open','');
      det.addEventListener('toggle', ()=> {
        dbeStorage.setItem(NOTE_OPEN_KEY, det.open ? 'true':'false');
      });
    }catch(_){}

    // 操作ボタン（保存 / キャンセル）
    const opsEl = document.createElement('div');
    opsEl.className = 'fc-ops fc-ops--center';
    Object.assign(opsEl.style, { display:'flex', gap:'8px', flexWrap:'wrap' });
    const btnSave = document.createElement('button');
    btnSave.textContent = '保存する';
    Object.assign(btnSave.style, { fontSize:'0.9em', padding:'4px 10px', margin:'0 3em 0 0' });
    const btnCancel = document.createElement('button');
    btnCancel.textContent = 'キャンセル';
    Object.assign(btnCancel.style, { fontSize:'0.9em', padding:'4px 10px', margin:'0' });
    opsEl.append(btnSave, btnCancel);

    // タブ（ネックレス / 武器 / 防具）
    const tabsEl = document.createElement('div');
    Object.assign(tabsEl.style, {
      display:'flex',
      gap:'8px',
      flexWrap:'wrap',
      justifyContent:'center',
      alignItems:'center',
      width:'100%',
      margin:'6px 0 10px'
    });    const tabN = document.createElement('button');
    tabN.textContent = 'ネックレス';
    Object.assign(tabN.style, { fontSize:'0.9em', padding:'4px 10px' });
    const tabW = document.createElement('button');
    tabW.textContent = '武器';
    Object.assign(tabW.style, { fontSize:'0.9em', padding:'4px 10px' });
    const tabA = document.createElement('button');
    tabA.textContent = '防具';
    Object.assign(tabA.style, { fontSize:'0.9em', padding:'4px 10px' });
    tabsEl.append(tabN, tabW, tabA);

    // 本体（上段：既存カード、下段：新規作成フォーム）
    const bodyEl = document.createElement('div');
    Object.assign(bodyEl.style, { display:'grid', gap:'8px' });
    const areaTop  = document.createElement('div'); // 既存カード一覧
    const areaForm = document.createElement('div'); // 新規カードフォーム
    areaForm.style.minWidth = 'min(92svw, 560px)';
    bodyEl.append(areaTop, areaForm);

    // ─────────────────────────────────────────────
    // グリッド内に区切り線を挿入（《動作モード》〜《マリモ》の5か所の「間」）
    // ─────────────────────────────────────────────
    function __mkSepRow(card){
      var d = document.createElement('div');
      d.className = 'fc-sep-row';
      try{
        var bc = getComputedStyle(card).borderTopColor || '#CCC';
        d.style.setProperty('--fc-border', bc);
      }catch(_){}
      return d;
    }
    function __insertGridSeparators(container){
      var card = container.querySelector('.fc-card');
      if (!card) return false;
      var grid = card.querySelector('.fc-grid');
      if (!grid) return false;
      // 左セル(.fc-left)のラベルで行を特定 → 右セルの直後に <div.fc-sep-row> を差し込む
      function findRightAfterLabel(labels){
        var kids = Array.from(grid.children);
        for (var i=0;i<kids.length;i++){
          var el = kids[i];
          if (!(el.classList && el.classList.contains('fc-left'))) continue;
          var t = (el.textContent || '').trim();
          for (var j=0;j<labels.length;j++){
            if (t.indexOf(labels[j]) !== -1){
              // 右セルは直後の兄弟
              var right = el.nextElementSibling;
              return right || null;
            }
          }
        }
        return null;
      }
      function needSepAfter(rightCell){
        if (!rightCell || !rightCell.parentNode) return false;
        for (var n = rightCell.nextSibling; n; n = n.nextSibling){
          if (n.nodeType !== 1) continue;
          if (n.classList && n.classList.contains('fc-sep-row')) return false; // 既にある
          if (n.classList && n.classList.contains('fc-left')) break;           // 次の行が始まった
        }
        return true;
      }
      var afters = [
        findRightAfterLabel(['《動作モード》','動作モード']),
        findRightAfterLabel(['《Rarity》','Rarity','レアリティ','《グレード》','グレード']),
        findRightAfterLabel(['《武器名》','《防具名》','武器名','防具名','《プロパティ数》','プロパティ数','《Buff》','Buff']),
        findRightAfterLabel(['《SPD》','《WT.》','SPD','WT.','《DeBuff》','DeBuff']),
        findRightAfterLabel(['《Element》','Element','属性','《増減値》','増減値']),
        findRightAfterLabel(['《マリモ》','マリモ'])
      ];
      var inserted = 0;
      for (var k=0;k<afters.length;k++){
        var cell = afters[k];
        if (cell && needSepAfter(cell)){
          grid.insertBefore(__mkSepRow(card), cell.nextSibling);
          inserted++;
        }
      }
      return inserted === afters.length; // 5本入ったら true
    }

    // ─────────────────────────────────────────────
    // 常駐監視：タブ切替や再描画のたびに強化処理を適用（重複しないよう冪等化）
    // ─────────────────────────────────────────────
    function __markMarimoInput(root){
      try{
        var checks = root.querySelectorAll('input[id$="-mrm-all"]'); // 例: fc-wep-mrm-all / fc-amr-mrm-all
        checks.forEach(function(chk){
          var left  = chk.closest('.fc-left');
          var right = left && left.nextElementSibling;
          var inp   = right && right.querySelector('input.fc-input[type="text"]');
          if (inp){ inp.classList.add('mrm-input'); } // 幅 10em は CSS .mrm-input で固定
        });
      }catch(_){}
    }
    function __applyFormEnhancements(){
      __insertGridSeparators(areaForm); // セパレータ（区切り線）を、あるべき場所にだけ挿入。（既にあれば何もしない）
      __markMarimoInput(areaForm);      // 《マリモ》入力にクラス付与。（再描画時も冪等）
    }
    // 初回適用
    __applyFormEnhancements();
    // 以後の変化を監視して都度適用（切断しない）
    var __formEnhancerObserver = new MutationObserver(function(){
      __applyFormEnhancements();
    });
    __formEnhancerObserver.observe(areaForm, {childList:true, subtree:true});

    // ─────────────────────────────────────────────
    // タブ幅を固定化（ネックレス/武器/防具の文字にマッチする要素へクラス .dbe-tab 付与）
    // ─────────────────────────────────────────────
    function __applyTabWidth(root){
      try{
        // 候補：button / [role=tab] / a.tab など（幅広に拾ってテキストで判定）
        const candidates = root.querySelectorAll('button, [role="tab"], a, .tab, .tabs button, .tabs [role="tab"]');
        candidates.forEach(el=>{
          const t = (el.textContent || '').trim();
          if (t === 'ネックレス' || t === '武器' || t === '防具'){
            el.classList.add('dbe-tab');
          }
        });
      }catch(_){}
    }
    // 初回適用
    __applyTabWidth(document);
    // タブやフォームの再構築にも追随
    const __tabObserver = new MutationObserver(()=>{ __applyTabWidth(document); });
    __tabObserver.observe(document.body, {childList:true, subtree:true});

    // （削除）《Element》自動ONのグローバル監視は撤去しました。
    // 以降は各フォームの「カードを追加」クリック内でローカルに実施します。

    // ─────────────────────────────────────────────
    // 表示整形のローカル実装（外部 formatRuleHTML に依存しない）
    // ─────────────────────────────────────────────
    function makeBadge(text, style){
      const span = document.createElement('span');
      span.textContent = text;
      Object.assign(span.style, {
        display:'inline-block',
        border:'2px solid #666',
        fontSize:'1.1em',
        fontWeight:'bold',
        width:'4em',
        textAlign:'center',
        lineHeight:'1.6'
      });
      span.style.backgroundColor = style?.bg || '#FFF';
      span.style.color = style?.fg || '#000';
      return span.outerHTML;
    }
    function typeBadge(type){
      return makeBadge(type==='lock'?'ロック':'分解', {
        bg: type==='lock' ? '#00F' : '#F00',
        fg:'#FFF'
      });
    }
    function rarityBadge(r){
      const map = { UR:{bg:'#F45D01',fg:'#FFF'}, SSR:{bg:'#A633D6',fg:'#FFF'}, SR:{bg:'#2175D9',fg:'#FFF'}, R:{bg:'#3FA435',fg:'#FFF'}, N:{bg:'#FFFFFF',fg:'#000'} };
      const sty = map[r] || {bg:'#FFF',fg:'#000'};
      return makeBadge(r || '', sty);
    }
    function namesText(kind, nameObj){
      const head = kind==='wep' ? '《武器名》' : '《防具名》';
      if (!nameObj || nameObj.mode==='all') return head + 'すべて';
      const raw = (nameObj.keywords||'').trim();
      const list = raw.split(/[；;]+/).map(s=>s.trim()).filter(Boolean);
      return head + (list.length ? list.join('；') : '不問');
    }
    // 先頭の《…》だけを <span class="fc-param-head"> で包む
    function wrapParamHead(s){
      try{
        return String(s).replace(/^《[^》]+》/, function(m){ return '<span class="fc-param-head">'+m+'</span>'; });
      }catch(_){ return s; }
    }
    function elementText(elmObj){
      if (!elmObj || elmObj.all) return '《Element》不問';
      const sel = Array.isArray(elmObj.selected) ? elmObj.selected : [];
      return '《Element》' + (sel.length ? sel.join('；') : '不問');
    }
    function marimoText(mrmObj){
      if (!mrmObj || mrmObj.mode!=='spec') return '《マリモ》不問';
      const num = (mrmObj.text ?? mrmObj.value ?? '').toString().trim();
      const bd  = (mrmObj.border || '').trim();
      if (!num || !bd) return '《マリモ》不問';
      return '《マリモ》' + num + ' ' + bd;
    }
    // ==== 表示専用（Rarityバッジ & SPD/WT テキスト） ====
    function rarityBadgesHTML(raw){
      // "all"/"すべて" / 配列 / {UR:true,...} / {all:true} に広く対応
      const ALL = ['UR','SSR','SR','R','N'];
      function isAll(obj){
        if (!obj) return false;
        if (obj==='すべて' || obj==='不問') return true;
        if (typeof obj==='string' && obj.toLowerCase()==='all') return true;
        if (Array.isArray(obj)) return ALL.every(v=>obj.includes(v));
        if (typeof obj==='object'){
          if (obj.all===true) return true;
          const picked = ALL.filter(v=>obj[v]);
          return picked.length===ALL.length;
        }
        return false;
      }
      let list = [];
      if (!raw || isAll(raw)) list = ALL;
      else if (Array.isArray(raw)) list = raw.slice();
      else if (typeof raw==='object') list = ALL.filter(v=>raw[v]);
      else list = [String(raw)];
      // バッジHTML列
      return list.map(rv => `<span class="rar-badge rar-${rv}">${rv}</span>`).join('');
    }

    // ==== 表示専用（ロジック：AND/OR バッジ） ====
    function logicBadgeHTML(op){
      const v = (String(op || 'AND').toUpperCase() === 'OR') ? 'OR' : 'AND';
      return `<span class="logic-badge logic-${v}">${v}</span>`;
    }

    function statPretty(label, raw){
      // 表示ヘッダ（《SPD》/《WT.》）
      function head(){ return '《' + label + '》'; }
       // 未指定 → 不問
      if (!raw) return head() + '不問';
      // 文字列
      if (typeof raw === 'string'){
        var s = raw.trim();
        if (s.toLowerCase && s.toLowerCase() === 'all' || s === 'すべて' || s === '不問') return head() + '不問';
        var n = Number(s);
        return Number.isFinite(n) ? (head() + n) : (head() + s);
      }
      // 配列
      if (Array.isArray(raw)){
        return raw.length ? (head() + raw.join('；')) : (head() + '不問');
      }
      // オブジェクト
      if (typeof raw === 'object'){
        if (raw.all === true) return head() + '不問';
        if (Array.isArray(raw.list) && raw.list.length){
          return head() + raw.list.join('；');
        }
        // { value, border } 形式
        var val = (raw.value == null ? '' : String(raw.value)).trim();
        var bd  = (raw.border == null ? '' : String(raw.border)).trim();
        if (val !== '' && bd !== '') return head() + (val + ' ' + bd);
        // range: {min, max}
        var hasMin = Number.isFinite(raw.min);
        var hasMax = Number.isFinite(raw.max);
        if (hasMin && hasMax) return head() + (raw.min + '〜' + raw.max);
        if (hasMin)           return head() + (raw.min + '以上');
        if (hasMax)           return head() + (raw.max + '以下');
        // ここまで該当なし → すべて
        return head() + '不問';
      }
      return head() + '不問';
    }

    // ==== Element 色の自動取得 & バッジHTML化 ====
    const __elemColorCache = new Map();
    const __elemFallback = {
      '火':'#E74C3C','氷':'#5DADE2','雷':'#F1C40F','風':'#27AE60',
      '地':'#8E7D62','水':'#3498DB','光':'#F5E663','闇':'#6C5B7B','なし':'#9E9E9E'
    };
    function sniffElemColor(sym){
      if (!sym) return '#9E9E9E';
      if (__elemColorCache.has(sym)) return __elemColorCache.get(sym);
      // 1) 武器/防具テーブルのセルから既存の色を取得（最初に見つかった1件）
      const tds = document.querySelectorAll('#weaponTable td, #armorTable td');
      for (let i=0; i<tds.length && i<3000; i++){  // 安全のため上限
        const td = tds[i];
        if (td.textContent.trim() === sym){
          const col = getComputedStyle(td).color;
          if (col && col !== 'rgb(0, 0, 0)'){ // 初期値っぽい黒は弾く
            __elemColorCache.set(sym, col);
            return col;
          }
        }
      }
      // 2) 既存の色付け関数があれば試す（将来拡張用）
      try{
        if (typeof window.DBE_getElementColor === 'function'){
          const c = window.DBE_getElementColor(sym);
          if (c){ __elemColorCache.set(sym, c); return c; }
        }
      }catch(_){}
      // 3) フォールバック
      const fb = __elemFallback[sym] || '#9E9E9E';
      __elemColorCache.set(sym, fb);
      return fb;
    }

    function elemBadgesHTML(raw){
      // 受理形式:
      //  'all' / 'すべて' / {all:true} / {mode:'all'}
      //  ['火','氷',...] / {selected:[...]} / {list:[...]}
      //  {flags:{火:true,...}} / {火:true,...}
      var ALL = ['火','氷','雷','風','地','水','光','闇','なし'];

      function isAllString(s){
        return (typeof s === 'string') && (s.toLowerCase() === 'all' || s === 'すべて' || s === '不問');
      }

      // 1) 明示的「すべて」判定
      var isExplicitAll = false;
      if (raw != null){
        if (typeof raw === 'string'){
          if (isAllString(raw)) isExplicitAll = true;
        } else if (typeof raw === 'object'){
          if (raw.all === true || raw.mode === 'all') isExplicitAll = true;
        }
      }

      // 2) 選択の抽出
      var picked = [];
      if (raw != null){
        if (typeof raw === 'string'){
          if (!isExplicitAll && raw) picked = [raw];
        } else if (Array.isArray(raw)){
          picked = raw.slice();
        } else if (typeof raw === 'object'){
          if (Array.isArray(raw.selected)) picked = raw.selected.slice();
          else if (Array.isArray(raw.list)) picked = raw.list.slice();
          else if (raw.flags && typeof raw.flags === 'object'){
            picked = ALL.filter(function(k){ return !!raw.flags[k]; });
          } else {
            var keys = Object.keys(raw);
            if (keys.length && keys.every(function(k){ return ALL.indexOf(k) !== -1; })){
              picked = ALL.filter(function(k){ return !!raw[k]; });
            }
          }
        }
      }

      // 3) 正規化（未知要素除外・重複排除・順序安定化）
      picked = picked.filter(function(v, i, arr){
        return ALL.indexOf(v) !== -1 && arr.indexOf(v) === i;
      });
      picked.sort(function(a,b){ return ALL.indexOf(a) - ALL.indexOf(b); });

      // 4) 表示ルール
      //   ・明示的 all か、9要素すべて選択 → 《Element》すべて
      //   ・部分選択 → バッジ列
      //   ・完全未選択/不明 → 空（セパレータ抑止のため）
      if (isExplicitAll || picked.length === ALL.length){
        return '《Element》すべて';
      }
      if (picked.length === 0){
        return '';
      }
      // 背景色から読みやすい文字色を決める（相対輝度で黒/白を選択）
      function contrastTextFor(bg){
        // rgb(...) / rgba(...) / #RRGGBB / #RGB に対応
        var r=0,g=0,b=0, m;
        if ((m = String(bg||'').trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i))){
          var hex = m[1].length===3
            ? m[1].split('').map(function(c){ return c + c; }).join('')
            : m[1];
          r = parseInt(hex.slice(0,2),16);
          g = parseInt(hex.slice(2,4),16);
          b = parseInt(hex.slice(4,6),16);
        } else if ((m = String(bg||'').trim().match(/^rgba?\((\d+)[ ,]+(\d+)[ ,]+(\d+)/i))){
          r = +m[1]; g = +m[2]; b = +m[3];
        } else {
          // 不明な表記 → 既定：黒文字
          return '#000';
        }
        // 相対輝度（sRGB -> linear）から単純判定
        function lin(c){ c/=255; return (c<=0.03928) ? (c/12.92) : Math.pow((c+0.055)/1.055, 2.4); }
        var L = 0.2126*lin(r) + 0.7152*lin(g) + 0.0722*lin(b);
        return (L < 0.5) ? '#FFF' : '#000';
      }
      return picked.map(function(sym){
        var bg = sniffElemColor(sym);
        var fg = contrastTextFor(bg);
        // CSS変数で背景/枠色と文字色を渡す
        return '<span class="elem-badge" style="--elem-bg:' + bg + ';--elem-fg:' + fg + ';">' + sym + '</span>';
      }).join('');
    }

    // ▼▼▼ ここから追加：表示専用のサマリー関数 ▼▼▼
    function rarityIsAll(raw){
      // 受け取りうる形式を網羅的に許容
      if (!raw) return false;
      if (raw === 'すべて' || raw === '不問') return true;
      if (typeof raw === 'string' && raw.toLowerCase() === 'all') return true;
      if (Array.isArray(raw)) {
        const SET = new Set(raw);
        return ['UR','SSR','SR','R','N'].every(x=>SET.has(x));
      }
      if (typeof raw === 'object') {
        if (raw.all === true) return true;
        const picked = ['UR','SSR','SR','R','N'].filter(k=>raw[k]);
        return picked.length === 5;
      }
      return false;
    }
    function rarityView(raw){
      if (!raw || rarityIsAll(raw)) return 'Rarity（不問）';
      // 単一・複数いずれも「／」区切りで表示
      if (Array.isArray(raw)) return 'Rarity（' + raw.join('／') + '）';
      if (typeof raw === 'object'){
        const picked = ['UR','SSR','SR','R','N'].filter(k=>raw[k]);
        return picked.length ? 'Rarity（' + picked.join('／') + '）' : '';
      }
      return 'Rarity（' + String(raw) + '）';
    }
    function statView(label, raw){
      // 想定形式の例：
      //  - 'all' / 'すべて'
      //  - {all:true}
      //  - {min:10,max:20} / {min:10} / {max:20}
      //  - [12,14,18]
      //  - {list:[..]}
      if (!raw) return ''; // 未指定は非表示
      if (typeof raw === 'string'){
        if (raw.toLowerCase?.()==='all' || raw==='すべて' || raw==='不問') return `${label}（不問）`;
        const num = Number(raw);
        return Number.isFinite(num) ? `${label}（${num}）` : `${label}（${raw}）`;
      }
      if (Array.isArray(raw)){
        return raw.length ? `${label}（${raw.join('／')}）` : '';
      }
      if (typeof raw === 'object'){
        if (raw.all === true) return `${label}（不問）`;
        if (Array.isArray(raw.list) && raw.list.length){
          return `${label}（${raw.list.join('／')}）`;
        }
        const hasMin = Number.isFinite(raw.min);
        const hasMax = Number.isFinite(raw.max);
        if (hasMin && hasMax) return `${label}（${raw.min}〜${raw.max}）`;
        if (hasMin)            return `${label}（${raw.min}以上）`;
        if (hasMax)            return `${label}（${raw.max}以下）`;
      }
      return '';
    }
    // ▲▲▲ 追加ここまで ▲▲▲

    // 既存フィルタカード（個別）のレイアウト
    function formatRuleHTMLLocal(kind, card){
      const chunks = [];
      const unasked = []; // 「不問」になっている項目名を末尾にまとめる

      function isUnaskedText(s){
        try{
          if (typeof s !== 'string') return false;
          const t = s.trim();
          return t.endsWith('不問') || t.endsWith('すべて');
        }catch(_){ return false; }
      }
      function pushOrUnasked(html, itemName, isUnasked){
        if (isUnasked){
          if (itemName) unasked.push(itemName);
          return;
        }
        if (html) chunks.push('／' + html);
      }

      // 「《...》すべて」を少し大きめに表示したい時だけ個別に適用する
      function bigAll(html){
        return `<span style="font-size:1.12em;">${html}</span>`;
      }

      // 1) ロック/分解
      chunks.push(typeBadge(card.type));

      if (kind==='wep' || kind==='amr'){
        // 2) 武器/防具名
        {
          // ※「武器名/防具名」だけは「不問まとめ（末尾の【不問】）」を適用しない
          //   「すべて」や「不問」でも常に《ロジック》の前（本来位置）に表示する
          const fallback = `《${kind==='wep'?'武器名':'防具名'}》すべて`;
          const nameTxt = namesText(kind, card.name) || fallback;
          const nameHtml = wrapParamHead(nameTxt);
          const isAllName = /^《(?:武器名|防具名)》\s*すべて$/.test(String(nameTxt || '').trim());
          chunks.push('／' + (isAllName ? bigAll(nameHtml) : nameHtml));
        }

         // 3) Rarity（バッジ）
        {
          // 「すべて」の場合：バッヂではなく「《Rarity》すべて」の文字列を表示（不問グループへは移動しない）
          const isAll = (!card.rarity || rarityIsAll(card.rarity));
          if (isAll){
            chunks.push('／' + bigAll(wrapParamHead('《Rarity》すべて')));
          } else {
            chunks.push('／' + rarityBadgesHTML(card.rarity));
          }
        }

        // 4) Element（バッジ・テーブル配色を反映／空なら出さない）
        {
          const ehtml = elemBadgesHTML(card.elm);
          // 「すべて」の場合：バッヂではなく「《Element》すべて」の文字列を表示（不問グループへは移動しない）
          const isAll = (!ehtml || ehtml === '《Element》すべて');
          if (isAll){
            chunks.push('／' + bigAll(wrapParamHead('《Element》すべて')));
          } else {
            // バッジHTMLならそのまま、テキスト（《...》形式）なら見出しだけ縮小
            const out = (ehtml[0] === '《') ? wrapParamHead(ehtml) : ehtml;
            chunks.push('／' + out);
          }
        }

        // 5) ロジック（AND/OR）
        {
          const op = String(card.fop || 'AND').toUpperCase();
          chunks.push('／' + logicBadgeHTML(op));
        }

        // 6) SPD / WT.
        if (kind==='wep'){
          const s = statPretty('SPD', card.spd || card.SPD);
          pushOrUnasked(wrapParamHead(s), 'SPD', isUnaskedText(s));
        } else {
          const wnd = statPretty('WT.', card.wt || card.WT || card['WT.']);
          pushOrUnasked(wrapParamHead(wnd), 'WT.', isUnaskedText(wnd));
        }

        // 7) minATK/maxATK or minDEF/maxDEF
        if (kind==='wep'){
          const mn = statPretty('minATK', card.minATK);
          pushOrUnasked(wrapParamHead(mn), 'minATK', isUnaskedText(mn));
          const mx = statPretty('maxATK', card.maxATK);
          pushOrUnasked(wrapParamHead(mx), 'maxATK', isUnaskedText(mx));
        } else {
          const mn = statPretty('minDEF', card.minDEF);
          pushOrUnasked(wrapParamHead(mn), 'minDEF', isUnaskedText(mn));
          const mx = statPretty('maxDEF', card.maxDEF);
          pushOrUnasked(wrapParamHead(mx), 'maxDEF', isUnaskedText(mx));
        }

        // 8) CRIT
        {
          const cr = statPretty('CRIT', card.crit || card.CRIT);
          pushOrUnasked(wrapParamHead(cr), 'CRIT', isUnaskedText(cr));
        }

        // 9) マリモ
        {
          const mt = marimoText(card.mrm);
          pushOrUnasked(wrapParamHead(mt), 'マリモ', isUnaskedText(mt));
        }

        // 10) 末尾に「不問」項目をまとめて表示
        if (unasked.length){
          const uniq = Array.from(new Set(unasked));
          chunks.push('／' + `<span style="font-size:0.85em;color:#AAA;">【不問】${uniq.join('、')}</span>`);
        }

      } else {
        let rest = (card.label || '').replace(/^【(?:ロック|分解)】/,'').trim();
        if (rest){
          // 既存保存データの全角括弧（ ）は表示時に撤去
          rest = rest.replace(/[（）]/g, '');
          // 《グレード》の値と値の間に含まれる「／」だけを撤去（他セクションの区切りは保持）
          // 先頭の《グレード》〜次の「／」までの区間を取り出して、その中の「／」を空にする
          rest = rest.replace(/(《グレード》)([^／]*?)(?=／|$)/, (_m, head, body)=> head + body.replace(/／/g,''));
          // 《ネックレス》：グレード（プラチナ/金/銀/青銅/銅）をRarityと同じ配色で着色
          const GR_MAP = { 'プラチナ':'UR', '金':'SSR', '銀':'SR', '青銅':'R', '銅':'N' };
          rest = rest.replace(/プラチナ|青銅|金|銀|銅/g, (m)=>`<span class="rar-badge rar-${GR_MAP[m]}">${m}</span>`);
          chunks.push('／' + rest);
        }
      }
      return chunks.join('');
    }

    // ─────────────────────────────────────────────
    // 既存カードの描画
    // ─────────────────────────────────────────────
    function openEditRuleWindow(kind, idx){
      if (!(kind === 'wep' || kind === 'amr')) return;
      try{
        const arr = (kind==='wep') ? (_rulesData.wep || []) : (_rulesData.amr || []);
        const src = arr[idx];
        if (!src) return;

        const wnd = ensureWindowShell('dbe-W-RuleEdit');
        // closeBtn（先頭）以外をクリア
        Array.from(wnd.children).slice(1).forEach(n=>n.remove());

        const head = document.createElement('div');
        head.textContent = `フィルタカード再編集（${kind==='wep'?'武器':'防具'} #${idx+1}）`;
        Object.assign(head.style,{ fontWeight:'bold', margin:'0 0 6px 0' });

        const body = document.createElement('div');
        Object.assign(body.style,{ maxWidth:'min(97svw, 860px)', minWidth:'min(92svw, 560px)' });

        let initial;
        try{ initial = JSON.parse(JSON.stringify(src)); }catch(_e){ initial = src; }

        const onClose = ()=>{ try{ wnd.style.display='none'; }catch(_e){} };
        let built = null;
        try{
          built = buildFilterForm(kind, { edit:true, editIndex: idx, initialRule: initial, onClose });
        }catch(err){
          console.warn('[DBE] buildFilterForm(edit) failed:', err);
        }
        if (built) body.appendChild(built);

        wnd.append(head, body);
        wnd.style.display = 'block';
        try{ dbeBringToFront(wnd); }catch(_e){}
      }catch(err){
        console.error('[DBE] openEditRuleWindow failed:', err);
      }
    }

    // フィルタカード
    function renderCards(kind){
      areaTop.innerHTML = '';
      const list = (kind === 'wep')
        ? (_rulesData.wep || [])
        : (kind === 'amr')
          ? (_rulesData.amr || [])
          : (_rulesData.nec || []);
      const cap = document.createElement('div');
      cap.textContent = '作成したフィルタカードの一覧：' + (kind === 'wep' ? '武器' : (kind==='amr' ? '防具' : 'ネックレス'));
      cap.style.fontWeight = 'bold';
      areaTop.appendChild(cap);
      if (!list.length){
        const empty = document.createElement('div');
        empty.textContent = '（まだカードがありません）';
        areaTop.appendChild(empty);
        return;
      }
      list.forEach((card, idx)=>{
        // 行コンテナ（武器/防具=4段：1段目=操作列 / 2段目=《武器名/防具名》 / 3段目=《Rarity》+《Element》 / 4段目=《ロジック》+他条件+【不問】。ネックレスは従来通り）
        const row = document.createElement('div');
        // 種別ごとに背景色を変える（CSS変数で制御）
        row.classList.add('dbe-filter-card-row', `dbe-filter-card-row--${kind}`);
        Object.assign(row.style, {
          display:'flex',
          flexDirection:'column',
          alignItems:'stretch',
          gap:'12px',
          border:'1px solid #CCC', borderRadius:'12px', padding:'16px 8px', background:'var(--dbe-fc-bg, #FFF)',
          fontSize:'0.95em'
        });
        // 整形HTMLを取得
        let html = '';
        try{
          html = (typeof formatRuleHTML === 'function')
            ? formatRuleHTML(kind, card)
            : formatRuleHTMLLocal(kind, card);
        }catch(err){
          html = '';
        }
        // ロック/分解（先頭バッジ）とパラメータ（以降）を分割
        const p = html.indexOf('／');
        const badgeHTML  = (p>=0 ? html.slice(0, p) : html) || '';
        const paramsHTML = (p>=0 ? html.slice(p+1) : '') || '';

        // params を「《武器名/防具名》」(2段目) / 《Rarity》+《Element》(3段目) / それ以外(4段目) に分割（武器/防具のみ）
        let nameHTML = '';
        let rarityHTML = '';
        let restHTML = '';
        if (kind === 'wep' || kind === 'amr'){
          const parts = (paramsHTML || '').split('／').filter(s=>s!=='' );
          nameHTML = (parts.length ? parts[0] : '') || '';
          const tail = parts.slice(1);
          const rIdx = tail.findIndex(s => {
            const t = String(s || '');
            // バッジ表示（rar-badge）だけでなく、「《Rarity》すべて」のテキスト表示も同段に拾う
            return t.includes('rar-badge') || t.includes('《Rarity》');
          });
          const eIdx = tail.findIndex(s => {
            const t = String(s || '');
            return t.includes('elem-badge') || t.includes('《Element》');
          });
          const picked = [];
          if (rIdx >= 0) picked.push(tail[rIdx] || '');
          if (eIdx >= 0 && eIdx !== rIdx) picked.push(tail[eIdx] || '');
          // 《Rarity》／《Element》は同段で見せたいので、区切りは折り返しに馴染む span にする
          rarityHTML = picked.filter(Boolean).join('<span style="margin:0 0.25em;">／</span>') || '';
          restHTML = tail.filter((_, i)=>i !== rIdx && i !== eIdx).join('／') || '';
        }else{
          // ネックレスは従来通り（2段目=名称 / 3段目=残り）
          const q = paramsHTML.indexOf('／');
          nameHTML = (q>=0 ? paramsHTML.slice(0, q) : paramsHTML) || '';
          restHTML = (q>=0 ? paramsHTML.slice(q+1) : '') || '';
        }

        // [1段目] 操作列：［通し番号＋上移動UI］ / ロックor分解バッジ / 再編集 / 削除（概ね均等配置）
        const headRow = document.createElement('div');
        Object.assign(headRow.style, {
          display:'grid',
          // 4要素を均等に配置（ネックレスは「再編集」無しのため 3要素）
          gridTemplateColumns: (kind === 'wep' || kind === 'amr') ? '1fr 1fr 1fr 1fr' : '1fr 1fr 1fr',
          alignItems:'center',
          columnGap:'6px'
        });

        // 通し番号（左端）…［数字］、右側に 1em margin
        const numBox = document.createElement('div');
        numBox.textContent = `[${idx+1}]`;
        Object.assign(numBox.style, { marginRight:'1em' });

        // ============================================================
        // ▽ここから▽ フィルタカードの上移動UI
        // ------------------------------------------------------------
        // ▲（上へ）…「▲」はボタン化（他のボタン意匠を踏襲）。数値ボックス（整数のみ）は左に併設
        // 数値: 初期値1 / min=1 / max=フィルタカード通し番号の最終番号（= list.length）
        // 動作: 指定数だけ上へ移動（最小0でクランプ）
        // ------------------------------------------------------------
        const moveBadge = document.createElement('span');
        Object.assign(moveBadge.style,{
          display:'inline-flex',
          alignItems:'stretch',
          gap:'0',
          border:'1px solid #AAA',
          borderRadius:'6px',
          overflow:'hidden',
          height:'var(--dbe-moveui-h)'
        });
        // ------------------------------------------------------------
        // ★この値を変えるだけで「① / 数値 / ▲」ひとかたまりの高さを調整できる
        moveBadge.style.setProperty('--dbe-moveui-h','1.8em');
        // ------------------------------------------------------------

        // gridColumn は使わず、左グループ（通し番号＋上移動UI）としてまとめて配置する

        const upStep = document.createElement('input');
        upStep.type = 'number';
        upStep.inputMode = 'numeric';
        upStep.step = '1';
        upStep.min = '1';
        upStep.max = String(list.length);
        // 初期値 1（永続化しない：ページリロード等で常に 1 に戻る）
        upStep.value = '1';
        Object.assign(upStep.style,{
          width:'3.6em',
          height:'100%',
          boxSizing:'border-box',
          padding:'0 6px',
          border:'0',
          borderRadius:'0',
          fontSize:'0.9em',
          textAlign:'center',
          outline:'none'
        });
        // ① と ▲ に挟まれた「区切り線」（外枠は moveBadge が担当）
        upStep.style.borderLeft  = '1px solid #AAA';
        upStep.style.borderRight = '1px solid #AAA';

        const normalizeUpStep = ()=>{
          let v = parseInt(upStep.value, 10);
          if (!Number.isFinite(v) || v < 1) v = 1;
          const mx = Math.max(1, list.length);
          if (v > mx) v = mx;
          upStep.value = String(v);
        };

        upStep.addEventListener('change', (ev)=>{
          ev.stopPropagation();
          normalizeUpStep();
        });
        // 入力操作がカード行のクリック等へ波及しないように抑止
        upStep.addEventListener('click', (ev)=>ev.stopPropagation());
        upStep.addEventListener('keydown', (ev)=>ev.stopPropagation());

        // ①（初期値へ戻す）…クリックで数値ボックスを 1 に戻す
        const btnOne = document.createElement('button');
        btnOne.type = 'button';
        btnOne.textContent = '①';
        btnOne.title = '数値を 1 に戻す';
        Object.assign(btnOne.style,{
          margin:'0',
          fontWeight:'700',
          fontSize:'1.1em',
          height:'100%',
          padding:'0 8px',
          border:'0',
          borderRadius:'0',
          lineHeight:'1',
          display:'inline-flex',
          alignItems:'center',
          justifyContent:'center',
          background:'#EEE',
          cursor:'pointer'
        });
        // 左側ボタンの右に区切り線
        btnOne.style.borderRight = '1px solid #AAA';
        btnOne.addEventListener('click', (ev)=>{
          ev.preventDefault();
          ev.stopPropagation();
          upStep.value = '1';
          normalizeUpStep();
        });

        const btnUp = document.createElement('button');
        btnUp.type = 'button';
        btnUp.textContent = '▲';
        btnUp.title = 'このカードを上へ移動';
        Object.assign(btnUp.style,{
          margin:'0',
          fontWeight:'700',
          fontSize:'1.3em',
          height:'100%',
          padding:'0 10px',
          border:'0',
          borderRadius:'0',
          lineHeight:'1',
          display:'inline-flex',
          alignItems:'center',
          justifyContent:'center',
          background:'#EEE',
          cursor:'pointer'
        });
        // 右側ボタンの左に区切り線
        btnUp.style.borderLeft = '1px solid #AAA';

        btnUp.addEventListener('click', (ev)=>{
          ev.preventDefault();
          ev.stopPropagation();
          normalizeUpStep();
          const arr = (kind==='wep') ? _rulesData.wep : (kind==='amr' ? _rulesData.amr : _rulesData.nec);
          if (!arr || !arr.length) return;
          if (idx <= 0) return;
          const step = (()=>{ const v = parseInt(upStep.value, 10); return Number.isFinite(v) ? Math.max(1, Math.floor(v)) : 1; })();
          const to = Math.max(0, idx - step);
          if (to === idx) return;
          const cur = arr.splice(idx, 1)[0];
          arr.splice(to, 0, cur);
          try{ if (typeof saveRulesToStorage==='function') saveRulesToStorage(); }catch(_e){}
          renderCards(kind);
        });

        moveBadge.append(btnOne, upStep, btnUp);
        // ------------------------------------------------------------
        // △ここまで△ フィルタカードの上移動UI
        // ============================================================

        // 「ロック」または「分解」バッジ
        const badgeBox = document.createElement('div');
        Object.assign(badgeBox.style, { margin:'0', fontSize:'0.85em', justifySelf:'center' });
        badgeBox.innerHTML = badgeHTML || '';
        badgeBox.style.gridColumn = '2';

        // 「再編集」ボタン（武器/防具のみ）…1段目の中央寄りに配置
        let btnEdit = null;
        if (kind === 'wep' || kind === 'amr'){
          btnEdit = document.createElement('button');
          btnEdit.textContent = '再編集';
          btnEdit.title = 'このカードを再編集';
          Object.assign(btnEdit.style,{ padding:'2px 16px', justifySelf:'center' });
          btnEdit.addEventListener('click', (ev)=>{
            ev.stopPropagation();
            openEditRuleWindow(kind, idx);
          });
          btnEdit.style.gridColumn = '3';
        }

        // ③削除
        const btnDel = document.createElement('button');
        btnDel.textContent = '削除';
        btnDel.title = 'このカードを削除';
        Object.assign(btnDel.style, { padding:'2px 8px', justifySelf:'end' });
        btnDel.addEventListener('click', (ev)=>{
          ev.stopPropagation();
          const arr = (kind==='wep') ? _rulesData.wep : (kind==='amr' ? _rulesData.amr : _rulesData.nec);
          arr.splice(idx, 1);
          try{ if (typeof saveRulesToStorage==='function') saveRulesToStorage(); }catch(_e){}
          renderCards(kind);
        });
        btnDel.style.gridColumn = (kind === 'wep' || kind === 'amr') ? '4' : '3';

        // 左端：［通し番号＋上移動UI］を 1つの要素としてまとめる（左寄せ）
        const leftGroup = document.createElement('div');
        Object.assign(leftGroup.style,{
          display:'inline-flex',
          alignItems:'center',
          justifySelf:'start'
        });
        leftGroup.append(numBox, moveBadge);

        headRow.appendChild(leftGroup); // col 1
        headRow.appendChild(badgeBox);  // col 2
        if (btnEdit) headRow.appendChild(btnEdit); // col 3（武器/防具のみ）
        headRow.appendChild(btnDel);    // col 4（武器/防具） or col 3（ネックレス）

        // [2段目] 《武器名/防具名》 or ネックレス名
        const nameRow = document.createElement('div');
        Object.assign(nameRow.style, { padding:'0px' });
        nameRow.innerHTML = nameHTML || '';

        // [3段目] 《Rarity》（武器/防具のみ）
        let rarityRow = null;
          if (kind === 'wep' || kind === 'amr'){
            if (rarityHTML){
              rarityRow = document.createElement('div');
              // 《Rarity》と《Element》を同段に並べ、端で折り返す
              Object.assign(rarityRow.style, {
                padding:'0px',
                display:'flex',
                flexWrap:'wrap',
                alignItems:'center',
                gap:'0px',
                whiteSpace:'normal'
              });
              rarityRow.innerHTML = rarityHTML;
            }
          }

        // [4段目] 《ロジック》バッジ、6条件、【不問】グループ
        const bodyRow = document.createElement('div');
        bodyRow.innerHTML = restHTML || '';

        if (rarityRow){
          row.append(headRow, nameRow, rarityRow, bodyRow);
        }else{
          row.append(headRow, nameRow, bodyRow);
        }
        areaTop.appendChild(row);
      });
    }

    // ─────────────────────────────────────────────
    // 新規カードフォーム（ローカルビルダー）―― leftCol/rightCol を明示し参照順序を固定
    // ─────────────────────────────────────────────
    function buildFilterForm(kind, opts){
      opts = opts || {};
      const isEdit = !!opts.edit;
      const card = document.createElement('div');
      card.className = 'fc-card';
      // 「フィルタカード」ビルダー/再編集 でID衝突を避ける（同時に存在しうるため分離）
      const targetId = isEdit ? 'filtercard-editor' : 'filtercard-builder';
      try{
        const prev = document.getElementById(targetId);
        if (prev && prev !== card) prev.removeAttribute('id');
      }catch(_e){}
      card.id = targetId;
      // ── 重要：武器/防具タブ用の入力状態・要素参照を外側スコープに用意して、
      // ⑦「カードを追加」ハンドラ（ブロック外）からも参照できるようにする
      let stateRarity, nameState, fopState, compState, elemState, mrmState, minStatState, maxStatState, critState;
      let nameInput, compInput, compSel, compWrap, mrmInput, mrmSel, mrmWrap, minStatInput, minStatSel, minStatWrap, maxStatInput, maxStatSel, maxStatWrap, critInput, critSel, critWrap;
      // ── セパレータ生成：外枠の境界色を拾って CSS 変数に流し込む
      function mkSepRow(type){
        const s = document.createElement('div');
        const t = (type==='b') ? 'b' : 'a';
        s.className = 'fc-sep-row fc-sep-row--' + t;
        try{
          const bc = getComputedStyle(card).borderTopColor || '#CCC';
          s.style.setProperty('--fc-border', bc);
        }catch(_){}
        return s;
      }
      // タイトル
      const title = document.createElement('div');
      title.className = 'fc-title';
      const fcCaption = (card.id === 'filtercard-editor') ? 'エディター' : 'ビルダー';
      title.textContent = `「フィルタカード」${fcCaption}（${kind==='wep'?'武器':(kind==='amr'?'防具':'ネックレス')}${isEdit?'：再編集':''}）`;
      card.appendChild(title);
      // グリッド本体
      const grid = document.createElement('div');
      grid.className = 'fc-grid';
      Object.assign(grid.style, { gap:'0' });
      card.appendChild(grid);

      const addSep = (type)=>{ grid.appendChild(mkSepRow(type)); };

      // 小ユーティリティ
      const mkLeft = (txt)=>{
        const d=document.createElement('div');
        d.className='fc-left fc-sec';
        d.textContent=txt;
        Object.assign(d.style,{ textAlign:'right', alignSelf:'start', padding:'8px 0 2px 0' });
        return d;
      };
      const mkRight = ()=>{
        const d=document.createElement('div');
        d.className='fc-right';
        Object.assign(d.style,{ textAlign:'left', alignSelf:'center', padding:'8px 0 2px 12px' });
        return d;
      };
      const addRow = (leftCol,rightCol)=>{
        const r=document.createElement('div');
        r.className='fc-row';
        grid.append(leftCol,rightCol);
        return r;
      };
      const setDimmed = (wrap,on)=>{
        wrap.classList.toggle('fc-dimmed', !!on);
        Array.from(wrap.querySelectorAll('input,select,textarea,button')).forEach(el=>{ el.disabled = !!on; });
      };

      // 左列の「不問」レイアウト（7条件用）
      //  - 2行：1行目=《条件名》 / 2行目=チェックボックス「不問」
      //  - 「不問」は右寄せ＋右端から 1em の余白
      const setLeftAll2Lines = (leftCol, titleText, allWrap)=>{
        leftCol.textContent = '';
        Object.assign(leftCol.style,{
          display:'flex',
          flexDirection:'column',
          alignItems:'stretch',
          justifyContent:'flex-start'
        });
        const t = document.createElement('div');
        t.textContent = titleText;
        Object.assign(t.style,{ width:'100%', textAlign:'right' });
        const r = document.createElement('div');
        Object.assign(r.style,{ width:'100%', display:'flex', justifyContent:'flex-end', paddingRight:'1em' });
        r.appendChild(allWrap);
        leftCol.append(t, r);
      };

      // 武器/防具 共通（ネックレスでは非表示）
      if (kind==='wep' || kind==='amr') {

      // ① 動作モード
      {
        const leftCol = mkLeft('《動作モード》');
        const rightCol = mkRight();
        const gp = document.createElement('div');
        Object.assign(gp.style,{ display:'flex', alignItems:'center' });
        // ロック
        const lb1=document.createElement('label');
        Object.assign(lb1.style,{ display:'inline-flex', alignItems:'center', gap:'0.1em', marginRight:'2em' });
        const r1 = document.createElement('input'); r1.type='radio'; r1.name=`fc-mode-${kind}`; r1.id=`fc-${kind}-mode-lock`;
        const t1 = document.createElement('span'); t1.textContent='ロック';
        lb1.htmlFor=r1.id; lb1.append(r1,t1);
        // 分解
        const lb2=document.createElement('label');
        Object.assign(lb2.style,{ display:'inline-flex', alignItems:'center', gap:'0.2em' });
        const r2 = document.createElement('input'); r2.type='radio'; r2.name=`fc-mode-${kind}`; r2.id=`fc-${kind}-mode-del`;
        const t2 = document.createElement('span'); t2.textContent='分解';
        lb2.htmlFor=r2.id; lb2.append(r2,t2);
        gp.append(lb1,lb2);
        rightCol.appendChild(gp);
        addRow(leftCol,rightCol);
      }
      addSep('b');

      // ② 名称（武器名/防具名）
      nameState = { all:false, text:'' }; nameInput = null;
      {
        const leftCol = mkLeft(`《${kind==='wep'?'武器名':'防具名'}》`);
        const rightCol = mkRight();
        const allWrap = document.createElement('label');
        allWrap.classList.add('fc-all-label');
        Object.assign(allWrap.style,{ display:'inline-flex', alignItems:'center', gap:'0' });
        const ckAll = document.createElement('input'); ckAll.type='checkbox'; ckAll.id=`fc-${kind}-name-all`;
        const allTxt = document.createElement('span'); allTxt.textContent='すべて';
        allWrap.htmlFor=ckAll.id; allWrap.append(ckAll, allTxt);
        setLeftAll2Lines(leftCol, leftCol.textContent.trim(), allWrap);
        const rightWrap = document.createElement('div');
        rightWrap.style.display='grid';
        rightWrap.style.rowGap='4px';
        // ★ 定義済みリストから設定（右ペイン上部・左寄せ）
        const btnPresetName = document.createElement('button');
        btnPresetName.type='button';
        btnPresetName.className='fc-preset-btn';
        btnPresetName.textContent='定義済みリストから設定する';
        btnPresetName.addEventListener('click', ()=>{
          try{
            dbeOpenNameRegistryPicker(kind, nameInput, ckAll);
          }catch(err){
            console.warn('[DBE] open name registry picker failed:', err);
            try{ alert('定義済みリストの表示に失敗しました。'); }catch(_){}
          }
        });
        nameInput = document.createElement('textarea');
        nameInput.className='fc-textarea';
        nameInput.placeholder='完全一致で指定。セミコロン「；」で区切り。（半角も全角もOK）';
        // 右ペイン：上=ボタン／下=テキストボックス
        rightWrap.append(btnPresetName, nameInput);
        const sync = ()=>{ nameState.all = ckAll.checked; setDimmed(rightWrap, ckAll.checked); };
        ckAll.addEventListener('change', sync);
        sync();
        rightCol.appendChild(rightWrap);
        addRow(leftCol,rightCol);
      }
      addSep('a');

      // ③ Rarity（v8.15.0.x で欠落していたため復活）
      stateRarity = { all:false, picks:new Set() };
      {
        const leftCol = mkLeft('《Rarity》');
        const rightCol = mkRight();
        const allWrap = document.createElement('label');
        allWrap.classList.add('fc-all-label');
        Object.assign(allWrap.style,{ display:'inline-flex', alignItems:'center', gap:'0' });
        const ckAll = document.createElement('input'); ckAll.type='checkbox'; ckAll.id=`fc-${kind}-rar-all`;
        const allTxt = document.createElement('span'); allTxt.textContent='すべて';
        allWrap.htmlFor=ckAll.id; allWrap.append(ckAll, allTxt);
        setLeftAll2Lines(leftCol, '《Rarity》', allWrap);
        const rightWrap = document.createElement('div');
        Object.assign(rightWrap.style,{ display:'flex', flexWrap:'wrap', gap:'1.5em' });
        ['UR','SSR','SR','R','N'].forEach(n=>{
          const pair = document.createElement('label');
          Object.assign(pair.style,{ display:'inline-flex', alignItems:'center', gap:'0.1em' });
          const c=document.createElement('input'); c.type='checkbox'; c.id=`fc-${kind}-rar-${n}`;
          const lb=document.createElement('span'); lb.textContent=n;
          pair.htmlFor=c.id; pair.append(c, lb);
          rightWrap.append(pair);
          c.addEventListener('change', ()=>{ if (c.checked) stateRarity.picks.add(n); else stateRarity.picks.delete(n); });
        });
        const sync = ()=>{ stateRarity.all = ckAll.checked; setDimmed(rightWrap, ckAll.checked); };
        ckAll.addEventListener('change', sync);
        sync();
        rightCol.appendChild(rightWrap);
        addRow(leftCol,rightCol);
      }
      addSep('a');

      // ④ Element
      elemState = { all:false, picks:new Set() };
      {
        const leftCol = mkLeft('《Element》');
        const rightCol = mkRight();
        const allWrap = document.createElement('label');
        allWrap.classList.add('fc-all-label');
        Object.assign(allWrap.style,{ display:'inline-flex', alignItems:'center', gap:'0' });
        const ckAll = document.createElement('input'); ckAll.type='checkbox'; ckAll.id=`fc-${kind}-elm-all`;
        const allTxt = document.createElement('span'); allTxt.textContent='すべて';
        allWrap.htmlFor=ckAll.id; allWrap.append(ckAll, allTxt);
        setLeftAll2Lines(leftCol, leftCol.textContent.trim(), allWrap);
        const rightWrap = document.createElement('div');
        Object.assign(rightWrap.style,{ display:'flex', flexWrap:'wrap', gap:'0.7em', 'vertical-align':'top'});
        ;['火','氷','雷','風','地','水','光','闇','なし'].forEach(n=>{
          const pair = document.createElement('label');
          Object.assign(pair.style,{ display:'inline-flex', alignItems:'center', gap:'0.1em' });
          const c=document.createElement('input'); c.type='checkbox'; c.id=`fc-${kind}-elm-${n}`;
          const lb=document.createElement('span'); lb.textContent=n;
          pair.htmlFor=c.id; pair.append(c, lb);
          rightWrap.append(pair);
          c.addEventListener('change', ()=>{ if (c.checked) elemState.picks.add(n); else elemState.picks.delete(n); });
        });
        const sync = ()=>{ elemState.all = ckAll.checked; setDimmed(rightWrap, ckAll.checked); };
        ckAll.addEventListener('change', sync);
        sync();
        rightCol.appendChild(rightWrap);
        addRow(leftCol,rightCol);
      }
      addSep('b');

      // ⑤ ロジック（AND/OR）
      // 初期状態：どちらも未選択（ユーザーが選んだ時点で AND/OR の排他が効く）
      fopState = { op:null };
      {
        const leftCol = mkLeft('《ロジック》');
        const rightCol = mkRight();
        const gp = document.createElement('div');
        Object.assign(gp.style,{ display:'flex', alignItems:'center' });
        // AND
        const lb1=document.createElement('label');
        Object.assign(lb1.style,{ display:'inline-flex', alignItems:'center', gap:'0.1em', marginRight:'2em' });
        const r1 = document.createElement('input'); r1.type='radio'; r1.name=`fc-fop-${kind}`; r1.id=`fc-${kind}-fop-and`;
        const t1 = document.createElement('span'); t1.textContent='AND';
        lb1.htmlFor=r1.id; lb1.append(r1,t1);
        // OR
        const lb2=document.createElement('label');
        Object.assign(lb2.style,{ display:'inline-flex', alignItems:'center', gap:'0.2em' });
        const r2 = document.createElement('input'); r2.type='radio'; r2.name=`fc-fop-${kind}`; r2.id=`fc-${kind}-fop-or`;
        const t2 = document.createElement('span'); t2.textContent='OR';
        lb2.htmlFor=r2.id; lb2.append(r2,t2);
        r1.addEventListener('change', ()=>{ if (r1.checked) fopState.op = 'AND'; });
        r2.addEventListener('change', ()=>{ if (r2.checked) fopState.op = 'OR';  });
        gp.append(lb1,lb2);
        rightCol.appendChild(gp);
        addRow(leftCol,rightCol);
      }
      addSep('a');

      // ⑥ SPD/WT
      compState = { all:false }; compInput = null; compSel = null; compWrap = null;
      {
        const leftCol = mkLeft(kind==='wep'?'《SPD》':'《WT.》');
        const rightCol = mkRight();
        const allWrap = document.createElement('label');
        allWrap.classList.add('fc-all-label');
        Object.assign(allWrap.style,{ display:'inline-flex', alignItems:'center', gap:'0' });
        const ckAll = document.createElement('input'); ckAll.type='checkbox'; ckAll.id=`fc-${kind}-cmp-all`;
        const allTxt = document.createElement('span'); allTxt.textContent='不問';
        allWrap.htmlFor=ckAll.id; allWrap.append(ckAll, allTxt);
        setLeftAll2Lines(leftCol, leftCol.textContent.trim(), allWrap);
        compWrap = document.createElement('div'); compWrap.className='fc-inline';
        compInput = document.createElement('input'); compInput.type='text'; compInput.className='fc-input'; compInput.style.width='5em';
        compSel = document.createElement('select'); compSel.className='fc-select';
        ['以上','未満'].forEach(o=>{ const op=document.createElement('option'); op.value=o; op.textContent=o; compSel.append(op); });
        Object.assign(compInput.style,{ height:'2em' });
        Object.assign(compSel.style,{ height:'2em' });
        compWrap.append(compInput, document.createTextNode(' '), compSel);
        const sync = ()=>{ compState.all = ckAll.checked; setDimmed(compWrap, ckAll.checked); };
        ckAll.addEventListener('change', sync);
        sync();
        rightCol.appendChild(compWrap);
        addRow(leftCol,rightCol);
      }
      addSep('a');

      // ④-2 minATK/maxATK（武器） or minDEF/maxDEF（防具） / CRIT
      minStatState = { all:false }; minStatInput = null; minStatSel = null; minStatWrap = null;
      maxStatState = { all:false }; maxStatInput = null; maxStatSel = null; maxStatWrap = null;
      critState    = { all:false }; critInput    = null; critSel    = null; critWrap    = null;
      {
        const labelMin = (kind==='wep') ? '《minATK》' : '《minDEF》';
        const labelMax = (kind==='wep') ? '《maxATK》' : '《maxDEF》';
        const idMin    = (kind==='wep') ? 'minATK' : 'minDEF';
        const idMax    = (kind==='wep') ? 'maxATK' : 'maxDEF';

        // minATK / minDEF
        {
          const leftCol  = mkLeft(labelMin);
          const rightCol = mkRight();
          const allWrap  = document.createElement('label');
          allWrap.classList.add('fc-all-label');
          Object.assign(allWrap.style,{ display:'inline-flex', alignItems:'center', gap:'0' });
          const ckAll = document.createElement('input'); ckAll.type='checkbox'; ckAll.id=`fc-${kind}-${idMin}-all`;
          const allTxt = document.createElement('span'); allTxt.textContent='不問';
          allWrap.htmlFor=ckAll.id; allWrap.append(ckAll, allTxt);
          setLeftAll2Lines(leftCol, leftCol.textContent.trim(), allWrap);

          minStatWrap  = document.createElement('div'); minStatWrap.className='fc-inline';
          minStatInput = document.createElement('input'); minStatInput.type='text'; minStatInput.className='fc-input'; minStatInput.style.width='5em';
          minStatSel   = document.createElement('select'); minStatSel.className='fc-select';
          ['以上','未満'].forEach(o=>{ const op=document.createElement('option'); op.value=o; op.textContent=o; minStatSel.append(op); });
          Object.assign(minStatInput.style,{ height:'2em' });
          Object.assign(minStatSel.style,{ height:'2em' });
          minStatWrap.append(minStatInput, document.createTextNode(' '), minStatSel);

          const sync = ()=>{ minStatState.all = ckAll.checked; setDimmed(minStatWrap, ckAll.checked); };
          ckAll.addEventListener('change', sync);
          sync();

          rightCol.appendChild(minStatWrap);
          addRow(leftCol,rightCol);
        }
        addSep('a');

        // maxATK / maxDEF
        {
          const leftCol  = mkLeft(labelMax);
          const rightCol = mkRight();
          const allWrap  = document.createElement('label');
          allWrap.classList.add('fc-all-label');
          Object.assign(allWrap.style,{ display:'inline-flex', alignItems:'center', gap:'0' });
          const ckAll = document.createElement('input'); ckAll.type='checkbox'; ckAll.id=`fc-${kind}-${idMax}-all`;
          const allTxt = document.createElement('span'); allTxt.textContent='不問';
          allWrap.htmlFor=ckAll.id; allWrap.append(ckAll, allTxt);
          setLeftAll2Lines(leftCol, leftCol.textContent.trim(), allWrap);

          maxStatWrap  = document.createElement('div'); maxStatWrap.className='fc-inline';
          maxStatInput = document.createElement('input'); maxStatInput.type='text'; maxStatInput.className='fc-input'; maxStatInput.style.width='5em';
          maxStatSel   = document.createElement('select'); maxStatSel.className='fc-select';
          ['以上','未満'].forEach(o=>{ const op=document.createElement('option'); op.value=o; op.textContent=o; maxStatSel.append(op); });
          Object.assign(maxStatInput.style,{ height:'2em' });
          Object.assign(maxStatSel.style,{ height:'2em' });
          maxStatWrap.append(maxStatInput, document.createTextNode(' '), maxStatSel);

          const sync = ()=>{ maxStatState.all = ckAll.checked; setDimmed(maxStatWrap, ckAll.checked); };
          ckAll.addEventListener('change', sync);
          sync();

          rightCol.appendChild(maxStatWrap);
          addRow(leftCol,rightCol);
        }
        addSep('a');

        // CRIT
        {
          const leftCol  = mkLeft('《CRIT》');
          const rightCol = mkRight();
          const allWrap  = document.createElement('label');
          allWrap.classList.add('fc-all-label');
          Object.assign(allWrap.style,{ display:'inline-flex', alignItems:'center', gap:'0' });
          const ckAll = document.createElement('input'); ckAll.type='checkbox'; ckAll.id=`fc-${kind}-crit-all`;
          const allTxt = document.createElement('span'); allTxt.textContent='不問';
          allWrap.htmlFor=ckAll.id; allWrap.append(ckAll, allTxt);
          setLeftAll2Lines(leftCol, leftCol.textContent.trim(), allWrap);

          critWrap  = document.createElement('div'); critWrap.className='fc-inline';
          critInput = document.createElement('input'); critInput.type='text'; critInput.className='fc-input'; critInput.style.width='5em';
          critSel   = document.createElement('select'); critSel.className='fc-select';
          ['以上','未満'].forEach(o=>{ const op=document.createElement('option'); op.value=o; op.textContent=o; critSel.append(op); });
          Object.assign(critInput.style,{ height:'2em' });
          Object.assign(critSel.style,{ height:'2em' });
          critWrap.append(critInput, document.createTextNode(' '), critSel);

          const sync = ()=>{ critState.all = ckAll.checked; setDimmed(critWrap, ckAll.checked); };
          ckAll.addEventListener('change', sync);
          sync();

          rightCol.appendChild(critWrap);
          addRow(leftCol,rightCol);
        }
      }
      addSep('a');

      // ⑥ マリモ
      mrmState = { all:false }; mrmInput = null; mrmSel = null; mrmWrap = null;
      {
        const leftCol = mkLeft('《マリモ》');
        const rightCol = mkRight();
        const allWrap = document.createElement('label');
        allWrap.classList.add('fc-all-label');
        Object.assign(allWrap.style,{ display:'inline-flex', alignItems:'center', gap:'0' });
        const ckAll = document.createElement('input'); ckAll.type='checkbox'; ckAll.id=`fc-${kind}-mrm-all`;
        const allTxt = document.createElement('span'); allTxt.textContent='不問';
        allWrap.htmlFor=ckAll.id; allWrap.append(ckAll, allTxt);
        setLeftAll2Lines(leftCol, leftCol.textContent.trim(), allWrap);
        mrmWrap = document.createElement('div'); mrmWrap.className='fc-inline';
        mrmInput = document.createElement('input'); mrmInput.type='text'; mrmInput.className='fc-input'; mrmInput.style.width='5em';
        const cap = document.createElement('span'); cap.textContent='マリモ';
        mrmSel = document.createElement('select'); mrmSel.className='fc-select';
        ['以上','未満'].forEach(o=>{ const op=document.createElement('option'); op.value=o; op.textContent=o; mrmSel.append(op); });
        Object.assign(mrmInput.style,{ height:'2em' });
        Object.assign(mrmSel.style,{ height:'2em' });
        mrmWrap.append(mrmInput, document.createTextNode(' '), cap, document.createTextNode(' '), mrmSel);
        const sync = ()=>{ mrmState.all = ckAll.checked; setDimmed(mrmWrap, ckAll.checked); };
        ckAll.addEventListener('change', sync);
        sync();
        rightCol.appendChild(mrmWrap);
        addRow(leftCol,rightCol);
      }
      addSep('b');
    }

      // ────────────────
      // ネックレス専用（grade / buff-count / debuff-count / delta%）
      // ────────────────
      if (kind === 'nec') {
        // 1) 動作モード（排他：ロック・分解のみ。左列の「すべて」チェックは撤去）
        (function(){
          const leftCol = mkLeft('《動作モード》');
          const rightCol = mkRight();
          // 右列：ロック/分解（ラジオ2択）
          const gp = document.createElement('div');
          Object.assign(gp.style,{ display:'flex', alignItems:'center' });
          const lb1=document.createElement('label');
          Object.assign(lb1.style,{ display:'inline-flex', alignItems:'center', gap:'0.1em', marginRight:'2em' });
          const r1 = document.createElement('input'); r1.type='radio'; r1.name=`fc-mode-${kind}`; r1.id=`fc-${kind}-mode-lock`;
          const t1 = document.createElement('span'); t1.textContent='ロック';
          lb1.htmlFor=r1.id; lb1.append(r1,t1);
          const lb2=document.createElement('label');
          Object.assign(lb2.style,{ display:'inline-flex', alignItems:'center', gap:'0.2em' });
          const r2 = document.createElement('input'); r2.type='radio'; r2.name=`fc-mode-${kind}`; r2.id=`fc-${kind}-mode-del`;
          const t2 = document.createElement('span'); t2.textContent='分解';
          lb2.htmlFor=r2.id; lb2.append(r2,t2);
          gp.append(lb1,lb2);
          rightCol.appendChild(gp);
          addRow(leftCol,rightCol);
        })();

        // 2) グレード（プラチナ/金/銀/青銅/銅）
        const gradeState = { all:false, picks:new Set() };
        (function(){
          const leftCol = mkLeft('《グレード》');
          const rightCol = mkRight();
          const leftStack = document.createElement('div');
          Object.assign(leftStack.style, { display:'flex', justifyContent:'flex-end', width:'100%' });
          const allLabel = document.createElement('label');
          allLabel.classList.add('fc-all-label');
          Object.assign(allLabel.style,{ display:'inline-flex', alignItems:'center', gap:'0' });
          const ckAll = document.createElement('input'); ckAll.type='checkbox'; ckAll.id=`fc-${kind}-grade-all`;
          const allTxt = document.createElement('span'); allTxt.textContent='不問';
          allLabel.htmlFor=ckAll.id; allLabel.append(ckAll, allTxt);
          leftStack.append(allLabel);
          leftCol.appendChild(leftStack);
          const rightWrap = document.createElement('div');
          Object.assign(rightWrap.style,{ display:'flex', flexWrap:'wrap', gap:'1.5em' });
          ['プラチナ','金','銀','青銅','銅'].forEach(n=>{
            const pair = document.createElement('label');
            Object.assign(pair.style,{ display:'inline-flex', alignItems:'center', gap:'0.1em' });
            const c=document.createElement('input'); c.type='checkbox'; c.id=`fc-${kind}-grade-${n}`;
            const lb=document.createElement('span'); lb.textContent=n;
            pair.htmlFor=c.id; pair.append(c, lb);
            rightWrap.append(pair);
            c.addEventListener('change', ()=>{ if (c.checked) gradeState.picks.add(n); else gradeState.picks.delete(n); });
          });
          const sync = ()=>{ gradeState.all = ckAll.checked; setDimmed(rightWrap, ckAll.checked); };
          ckAll.addEventListener('change', sync);
          sync();
          rightCol.appendChild(rightWrap);
          addRow(leftCol,rightCol);
        })();

        // 3) プロパティ数（項目数）0〜7・以上/未満　※ Buff + DeBuff の合計
        const propState = { all:false, num:'', op:'以上' }; let propInput, propSel, propWrap;
        (function(){
          // 左側は「《プロパティ数》」と「不問」を縦に2段表示（ユーザー要望）
          const leftCol = mkLeft('');
          leftCol.style.display = 'flex';
          leftCol.style.flexDirection = 'column';
          leftCol.style.alignItems = 'flex-end';
          leftCol.style.gap = '4px';

          const title = document.createElement('div');
          title.textContent = '《プロパティ数》';
          leftCol.appendChild(title);
          const rightCol = mkRight();
          const allWrap = document.createElement('label');
          allWrap.classList.add('fc-all-label');
          Object.assign(allWrap.style,{ display:'inline-flex', alignItems:'center', gap:'4px' });
          const ckAll = document.createElement('input'); ckAll.type='checkbox'; ckAll.id=`fc-${kind}-prop-all`;
          const allTxt = document.createElement('span'); allTxt.textContent='不問';
          allWrap.htmlFor=ckAll.id; allWrap.append(ckAll, allTxt);
          setLeftAll2Lines(leftCol, leftCol.textContent.trim(), allWrap);

          propWrap = document.createElement('div'); propWrap.className='fc-inline';
          propInput = document.createElement('input');
          propInput.type='number';
          propInput.min='0';
          propInput.max='7';
          propInput.step='1';
          propInput.className='fc-input';
          propInput.style.width='5em';
          propInput.id = `fc-${kind}-prop-num`;
          propSel = document.createElement('select');
          propSel.className='fc-select';
          propSel.id = `fc-${kind}-prop-op`;
          ['以上','未満'].forEach(o=>{ const op=document.createElement('option'); op.value=o; op.textContent=o; propSel.append(op); });
          Object.assign(propInput.style,{ height:'2em' });
          Object.assign(propSel.style,{ height:'2em' });
          propWrap.append(propInput, document.createTextNode(' '), propSel);

          const sync = ()=>{ propState.all = ckAll.checked; setDimmed(propWrap, ckAll.checked); };
          ckAll.addEventListener('change', sync);
          sync();
          rightCol.appendChild(propWrap);
          addRow(leftCol,rightCol);
        })();

        // 4) DeBuff（項目数）0〜7・以上/未満
        const debuffState = { all:false, num:'', op:'以上' }; let debuffInput, debuffSel, debuffWrap;
        (function(){
          const leftCol = mkLeft('《DeBuff》');
          const rightCol = mkRight();
          const allWrap = document.createElement('label');
          allWrap.classList.add('fc-all-label');
          Object.assign(allWrap.style,{ display:'inline-flex', alignItems:'center', gap:'0' });
          const ckAll = document.createElement('input'); ckAll.type='checkbox'; ckAll.id=`fc-${kind}-debuff-all`;
          const allTxt = document.createElement('span'); allTxt.textContent='不問';
          allWrap.htmlFor=ckAll.id; allWrap.append(ckAll, allTxt);
          setLeftAll2Lines(leftCol, leftCol.textContent.trim(), allWrap);
          debuffWrap = document.createElement('div'); debuffWrap.className='fc-inline';
          debuffInput = document.createElement('input');
          debuffInput.type='number';
          debuffInput.min='0';
          debuffInput.max='7';
          debuffInput.step='1';
          debuffInput.className='fc-input';
          debuffInput.style.width='5em';
          debuffInput.id = `fc-${kind}-debuff-num`;
          debuffSel = document.createElement('select');
          debuffSel.className='fc-select';
          debuffSel.id = `fc-${kind}-debuff-op`;
          ['以上','未満'].forEach(o=>{ const op=document.createElement('option'); op.value=o; op.textContent=o; debuffSel.append(op); });
          Object.assign(debuffInput.style,{ height:'2em' });
          Object.assign(debuffSel.style,{ height:'2em' });
          debuffWrap.append(debuffInput, document.createTextNode(' '), debuffSel);
          const sync = ()=>{ debuffState.all = ckAll.checked; setDimmed(debuffWrap, ckAll.checked); };
          ckAll.addEventListener('change', sync);
          sync();
          rightCol.appendChild(debuffWrap);
          addRow(leftCol,rightCol);
        })();

        // 5) 増減値（％）・以上/未満
        const deltaState = { all:false, num:'', op:'以上' }; let deltaInput, deltaSel, deltaWrap;
        (function(){
          const leftCol = mkLeft('《増減値》');
          const rightCol = mkRight();
          const allWrap = document.createElement('label');
          allWrap.classList.add('fc-all-label');
          Object.assign(allWrap.style,{ display:'inline-flex', alignItems:'center', gap:'0' });
          const ckAll = document.createElement('input'); ckAll.type='checkbox'; ckAll.id=`fc-${kind}-delta-all`;
          const allTxt = document.createElement('span'); allTxt.textContent='不問';
          allWrap.htmlFor=ckAll.id; allWrap.append(ckAll, allTxt);
          setLeftAll2Lines(leftCol, leftCol.textContent.trim(), allWrap);
          deltaWrap = document.createElement('div'); deltaWrap.className='fc-inline';
          deltaInput = document.createElement('input');
          deltaInput.type='text';
          deltaInput.className='fc-input';
          deltaInput.style.width='5em';
          deltaInput.id = `fc-${kind}-delta-val`;
          deltaSel = document.createElement('select');
          deltaSel.className='fc-select';
          deltaSel.id = `fc-${kind}-delta-op`;
          ['以上','未満'].forEach(o=>{ const op=document.createElement('option'); op.value=o; op.textContent=o; deltaSel.append(op); });
          Object.assign(deltaInput.style,{ height:'2em' });
          Object.assign(deltaSel.style,{ height:'2em' });
          deltaWrap.append(deltaInput, document.createTextNode(' '), deltaSel);
          const sync = ()=>{ deltaState.all = ckAll.checked; setDimmed(deltaWrap, ckAll.checked); };
          ckAll.addEventListener('change', sync);
          sync();
          rightCol.appendChild(deltaWrap);
          addRow(leftCol,rightCol);
        })();

        // 6) 追加/初期化/全消去（共通の ⑦ 行と同じ意匠でネックレスでも利用）
        // → この後の「⑦ ボタン列」でまとめて実装されるため、個別には行わない
        // 追加時のデータ収集を wep/amr と分岐させる（下の btnAdd ハンドラで kind==='nec' 分岐）
      }

      // ★ 再編集：初期値を反映（武器/防具のみ）
      if (isEdit && (kind==='wep' || kind==='amr') && opts && opts.initialRule){
        try{
          const rule0 = opts.initialRule || {};
          const fire = (el)=>{ try{ el && el.dispatchEvent(new Event('change', { bubbles:true })); }catch(_e){} };

          // 動作モード
          const rLock = card.querySelector(`#fc-${kind}-mode-lock`);
          const rDel  = card.querySelector(`#fc-${kind}-mode-del`);
          if (rule0.type === 'lock' && rLock){ rLock.checked = true; fire(rLock); }
          if (rule0.type === 'del'  && rDel ){ rDel.checked  = true; fire(rDel ); }

          // Rarity
          const ckRarAll = card.querySelector(`#fc-${kind}-rar-all`);
          const rarList = Array.isArray(rule0.rarity) ? rule0.rarity.slice() : null;
          if (ckRarAll){
            ckRarAll.checked = (!rarList || rarList.length===0);
            ['UR','SSR','SR','R','N'].forEach(n=>{
              const c = card.querySelector(`#fc-${kind}-rar-${n}`);
              if (c) c.checked = (!!rarList && rarList.indexOf(n) !== -1);
            });
            fire(ckRarAll);
            // state 同期
            if (stateRarity){
              stateRarity.all = !!ckRarAll.checked;
              if (stateRarity.picks && typeof stateRarity.picks.clear === 'function') stateRarity.picks.clear();
              ['UR','SSR','SR','R','N'].forEach(n=>{
                const c = card.querySelector(`#fc-${kind}-rar-${n}`);
                if (c && c.checked && stateRarity && stateRarity.picks) stateRarity.picks.add(n);
              });
            }
          }

          // 名称（武器名/防具名）
          const ckNameAll = card.querySelector(`#fc-${kind}-name-all`);
          if (ckNameAll && nameInput){
            const nm = rule0.name || {};
            const isAll = !(nm && nm.mode === 'spec' && (nm.keywords||'').trim());
            ckNameAll.checked = isAll;
            nameInput.value = isAll ? '' : String(nm.keywords||'').split(';').join('；');
            fire(ckNameAll);
            if (nameState){
              nameState.all = !!ckNameAll.checked;
              nameState.text = (nameInput.value||'');
            }
          }

          // ロジック（AND/OR）
          const rAnd = card.querySelector(`#fc-${kind}-fop-and`);
          const rOr  = card.querySelector(`#fc-${kind}-fop-or`);
          if (rule0.fop === 'OR' && rOr){ rOr.checked = true; fire(rOr); if (fopState) fopState.op = 'OR'; }
          else if (rAnd){ rAnd.checked = true; fire(rAnd); if (fopState) fopState.op = 'AND'; }

          // SPD / WT.
          const ckCmpAll = card.querySelector(`#fc-${kind}-cmp-all`);
          const cmpObj = (kind==='wep') ? (rule0.spd || null) : (rule0.wt || null);
          if (ckCmpAll && compInput && compSel){
            ckCmpAll.checked = (!cmpObj || !(String(cmpObj.value||'').trim()) || !(String(cmpObj.border||'').trim()));
            compInput.value = ckCmpAll.checked ? '' : String(cmpObj.value||'');
            compSel.value   = ckCmpAll.checked ? (compSel.value||'以上') : String(cmpObj.border||'以上');
            fire(ckCmpAll);
            if (compState) compState.all = !!ckCmpAll.checked;
          }

          // minATK/minDEF
          {
            const idMin = (kind==='wep') ? 'minATK' : 'minDEF';
            const obj = (kind==='wep') ? (rule0.minATK || null) : (rule0.minDEF || null);
            const ckAll = card.querySelector(`#fc-${kind}-${idMin}-all`);
            if (ckAll && minStatInput && minStatSel && minStatState){
              ckAll.checked = (!obj || !(String(obj.value||'').trim()) || !(String(obj.border||'').trim()));
              minStatInput.value = ckAll.checked ? '' : String(obj.value||'');
              minStatSel.value   = ckAll.checked ? (minStatSel.value||'以上') : String(obj.border||'以上');
              fire(ckAll);
              minStatState.all = !!ckAll.checked;
            }
          }

          // maxATK/maxDEF
          {
            const idMax = (kind==='wep') ? 'maxATK' : 'maxDEF';
            const obj = (kind==='wep') ? (rule0.maxATK || null) : (rule0.maxDEF || null);
            const ckAll = card.querySelector(`#fc-${kind}-${idMax}-all`);
            if (ckAll && maxStatInput && maxStatSel && maxStatState){
              ckAll.checked = (!obj || !(String(obj.value||'').trim()) || !(String(obj.border||'').trim()));
              maxStatInput.value = ckAll.checked ? '' : String(obj.value||'');
              maxStatSel.value   = ckAll.checked ? (maxStatSel.value||'以上') : String(obj.border||'以上');
              fire(ckAll);
              maxStatState.all = !!ckAll.checked;
            }
          }

          // CRIT
          {
            const obj = rule0.crit || null;
            const ckAll = card.querySelector(`#fc-${kind}-crit-all`);
            if (ckAll && critInput && critSel && critState){
              ckAll.checked = (!obj || !(String(obj.value||'').trim()) || !(String(obj.border||'').trim()));
              critInput.value = ckAll.checked ? '' : String(obj.value||'');
              critSel.value   = ckAll.checked ? (critSel.value||'以上') : String(obj.border||'以上');
              fire(ckAll);
              critState.all = !!ckAll.checked;
            }
          }

          // Element（elm）
          {
            const ckAll = card.querySelector(`#fc-${kind}-elm-all`);
            const elm = rule0.elm || {};
            const isAll = !!elm.all;
            const sel = Array.isArray(elm.selected) ? elm.selected.slice() : [];
            if (ckAll){
              ckAll.checked = isAll;
              const ALL = ['火','氷','雷','風','地','水','光','闇','なし'];
              ALL.forEach(n=>{
                const c = card.querySelector(`#fc-${kind}-elm-${n}`);
                if (c) c.checked = (!isAll && sel.indexOf(n)!==-1);
              });
              fire(ckAll);
              if (elemState){
                elemState.all = !!ckAll.checked;
                if (elemState.picks && typeof elemState.picks.clear === 'function') elemState.picks.clear();
                ALL.forEach(n=>{
                  const c = card.querySelector(`#fc-${kind}-elm-${n}`);
                  if (c && c.checked && elemState && elemState.picks) elemState.picks.add(n);
                });
              }
            }
          }

          // マリモ（mrm）
          {
            const ckAll = card.querySelector(`#fc-${kind}-mrm-all`);
            const mrm = rule0.mrm || {};
            const isAll = !(mrm && mrm.mode==='spec' && (String(mrm.value||'').trim()) && (String(mrm.border||'').trim()));
            if (ckAll && mrmInput && mrmSel && mrmState){
              ckAll.checked = isAll;
              mrmInput.value = isAll ? '' : String(mrm.value||'');
              mrmSel.value   = isAll ? (mrmSel.value||'以上') : String(mrm.border||'以上');
              fire(ckAll);
              mrmState.all = !!ckAll.checked;
            }
          }

        }catch(err){
          console.warn('[DBE] apply initial rule failed:', err);
        }
      }

      // ⑦ ボタン列
      {
        const line = document.createElement('div'); line.className='fc-actions';
        Object.assign(line.style,{ display:'flex', 'justify-content':'center', alignItems:'center', gap:'3em' });
        const btnAdd  = document.createElement('button'); btnAdd.type='button';  btnAdd.textContent='カードを追加';
        const btnInit = document.createElement('button'); btnInit.type='button'; btnInit.textContent='フォーム初期化';
        [btnInit, btnAdd].forEach(b=>Object.assign(b.style,{fontSize:'0.95em',padding:'4px 10px'}));
        const resetWrap = document.createElement('div');
        Object.assign(resetWrap.style,{ display:'inline-flex', alignItems:'center', gap:'0.1em' });
        const ckReset = document.createElement('input'); ckReset.type='checkbox'; ckReset.id=`fc-${kind}-reset-all`;
        const lbReset = document.createElement('label'); lbReset.htmlFor=ckReset.id; lbReset.textContent='全データを消去';
        const btnReset = document.createElement('button'); btnReset.type='button'; btnReset.textContent='実行';
        Object.assign(btnReset.style,{fontSize:'0.95em',padding:'4px 10px'});
        resetWrap.append(ckReset, lbReset, btnReset);
        line.append(btnAdd, btnInit, resetWrap);
        card.appendChild(line);

        // ★ 再編集モード：ボタンを「保存する」「キャンセル」に見せる
        if (isEdit){
          btnAdd.textContent = '保存する';
          btnInit.style.display = 'none';
          resetWrap.style.display = 'none';
          const btnCancelEdit = document.createElement('button');
          btnCancelEdit.type='button';
          btnCancelEdit.textContent='キャンセル';
          Object.assign(btnCancelEdit.style,{fontSize:'0.95em',padding:'4px 10px'});
          line.appendChild(btnCancelEdit);
          btnCancelEdit.addEventListener('click', ()=>{
            try{ if (opts && typeof opts.onClose === 'function') opts.onClose(); }catch(_e){}
          });
        }

        // 初期化
        btnInit.addEventListener('click', ()=>{
          // チェック状態と値のリセット
          card.querySelectorAll('input[type="checkbox"], input[type="radio"]').forEach(el=>{ el.checked=false; });
          card.querySelectorAll('input[type="text"], input[type="number"], textarea').forEach(el=>{ el.value=''; });
          card.querySelectorAll('select').forEach(el=>{ el.selectedIndex=0; });
          // 視覚効果クラスの解除
          card.querySelectorAll('.fc-dimmed').forEach(el=>el.classList.remove('fc-dimmed'));
          // ★ 重要：disabled を必ず解除
          card.querySelectorAll('input, select, textarea, button').forEach(el=>{ el.disabled = false; });
          // 状態オブジェクトの初期化
          if (kind==='wep' || kind==='amr'){
            stateRarity.all=false; stateRarity.picks.clear();
            nameState.all=false; nameState.text='';
            if (fopState) fopState.op = null;
            compState.all=false;
            if (minStatState) minStatState.all=false;
            if (maxStatState) maxStatState.all=false;
            if (critState)    critState.all=false;
            elemState.all=false; elemState.picks.clear();
            mrmState.all=false;
          }
        });

        // データリセット
        btnReset.addEventListener('click', async ()=>{
          if (!ckReset.checked){
            try{ dbeShowOkDialog('確認','リセットする場合はチェックボックスをONにしてください。'); }catch(_){}
            return;
          }
          const ok = await dbeConfirmAlert('警告','フィルタカードの全データを消去します。よろしいですか？','はい','いいえ');
          if (!ok) return;
          try{
            if (Array.isArray(_rulesData.wep)) _rulesData.wep.length = 0;
            if (Array.isArray(_rulesData.amr)) _rulesData.amr.length = 0;
            if (Array.isArray(_rulesData.nec)) _rulesData.nec.length = 0;
            if (typeof saveRulesToStorage==='function') saveRulesToStorage();
            renderCards(kind);
            btnInit.click();
          }catch(err){
            console.error('[DBE] reset rules failed:', err);
          } finally {
            ckReset.checked = false;
          }
        });

        // 追加する
        btnAdd.addEventListener('click', ()=>{
          // ① 多重クリック防止（すでに処理中なら無視）
          if (btnAdd.disabled) return;
          btnAdd.disabled = true;
          const mode = (card.querySelector(`#fc-${kind}-mode-lock`)?.checked ? 'lock' :
                        (card.querySelector(`#fc-${kind}-mode-del`)?.checked  ? 'del'  : null));

          // ①-0) 必須入力チェック（未設定項目の収集）
          const missing = [];
          if (!mode) missing.push('動作モード');

          if (kind==='wep' || kind==='amr'){
            // ①-1) wep/amr の内部状態オブジェクトをガード（未定義/不正なら安全停止）
            const okState =
              (stateRarity && typeof stateRarity==='object') &&
              (nameState   && typeof nameState  ==='object') &&
              (fopState    && typeof fopState   ==='object') &&
              (compState   && typeof compState  ==='object') &&
              (elemState   && typeof elemState  ==='object') &&
              (mrmState    && typeof mrmState   ==='object');
            if (!okState){
              try{ dbeShowOkDialog('エラー','内部状態の初期化に失敗しました。フォームを初期化してから、もう一度お試しください。'); }catch(_){}
              console.error('[DBE] add-card: state objects missing', {stateRarity, nameState, fopState, compState, elemState, mrmState, kind});
              btnAdd.disabled = false;
              return;
            }

            // Rarity：『すべて』or 1つ以上選択
            const rarityOk = !!(stateRarity.all || (stateRarity.picks && stateRarity.picks.size>0));
            if (!rarityOk) missing.push('Rarity');

            // 名称（武器名/防具名）：『すべて』or テキスト入力あり
            const nmOk = !!(nameState.all || (nameInput && (nameInput.value||'').trim().length>0));
            if (!nmOk) missing.push(kind==='wep'?'武器名':'防具名');

            // ロジック：AND/OR のどちらかが選択されていること（初期は両方OFF）
            const fopOk = !!(fopState && (fopState.op==='AND' || fopState.op==='OR'));
            if (!fopOk) missing.push('ロジック');

            // SPD/WT.：『すべて』or 数値＋比較
            const compOk = !!(compState.all || ((compInput && (compInput.value||'').trim()) && (compSel && compSel.value)));
            if (!compOk) missing.push(kind==='wep'?'SPD':'WT.');

            // Element：『すべて』or 1つ以上選択（自動ONは廃止）
            const elemOk = !!(elemState.all || (elemState.picks && elemState.picks.size>0));
            if (!elemOk) missing.push('Element');

            // マリモ：『すべて』or 数値＋比較
            const mrmOk = !!(mrmState.all || ((mrmInput && (mrmInput.value||'').trim()) && (mrmSel && mrmSel.value)));
            if (!mrmOk) missing.push('マリモ');

          } else if (kind==='nec'){
            // グレード：『すべて』or 1つ以上選択
            const gAll = !!card.querySelector('#fc-nec-grade-all')?.checked;
            let gPick = false;
            card.querySelectorAll('input[id^="fc-nec-grade-"]:not(#fc-nec-grade-all)').forEach(cb=>{ if (cb.checked) gPick = true; });
            if (!(gAll || gPick)) missing.push('グレード');

            // プロパティ数：『すべて』or 数値＋比較（Buff + DeBuff の合計）
            const pAll = !!card.querySelector('#fc-nec-prop-all')?.checked;
            const pVal = (card.querySelector('#fc-nec-prop-num')?.value||'').trim();
            const pOp  = (card.querySelector('#fc-nec-prop-op')?.value||'').trim();
            if (!(pAll || (pVal && pOp))) missing.push('プロパティ数');

            // DeBuff：『すべて』or 数値＋比較
            const dAll = !!card.querySelector('#fc-nec-debuff-all')?.checked;
            const dVal = (card.querySelector('#fc-nec-debuff-num')?.value||'').trim();
            const dOp  = (card.querySelector('#fc-nec-debuff-op')?.value||'').trim();
            if (!(dAll || (dVal && dOp))) missing.push('DeBuff');

            // 増減値：『すべて』or 数値＋比較
            const zAll = !!card.querySelector('#fc-nec-delta-all')?.checked;
            const zVal = (card.querySelector('#fc-nec-delta-val')?.value||'').trim();
            const zOp  = (card.querySelector('#fc-nec-delta-op')?.value||'').trim();
            if (!(zAll || (zVal && zOp))) missing.push('増減値');
          }

          // 未設定があればカード追加を中断し、案内ダイアログを表示
          if (missing.length > 0){
            const line2 = '《' + missing.join('》、《') + '》';
            const act = isEdit ? '保存する' : 'カードを追加';
            const msg = ['下記の項目が未設定です。', line2, `すべての項目を設定してから「${act}」ボタンを押してください。`].join('\n');
            try{ dbeShowOkDialog('案内', msg); }catch(_){ alert(msg); }
            btnAdd.disabled = false;
            return;
          }

          // ★ 安全弁： “完全に条件なしカード” は保存禁止
          //   前段（武器名/防具名・Rarity・Element）が全部「すべて」
          //   かつ 5条件（SPD/WT, min, max, CRIT, マリモ）が全部「不問」
          //   → 意図せず大量ヒットを招くため、保存自体をブロックする
          if (kind==='wep' || kind==='amr'){
            const frontAll = !!(nameState?.all && stateRarity?.all && elemState?.all);
            const fiveAllUnasked = !!(compState?.all && minStatState?.all && maxStatState?.all && critState?.all && mrmState?.all);
            if (frontAll && fiveAllUnasked){
              // ☆ 保存完了ダイアログ誤表示の抑止：
              //   このケースでは保存は行われないため、
              //   「保存する」意図フラグを落とし、次回の保存ダイアログ表示を1回抑止する
              try{
                window.__DBE_SAVE_DIALOG_INTENT = false;
                window.__DBE_SAVE_DIALOG_BLOCK_ONCE = true;
              }catch(_){}
              try{
                dbeShowAlertDialog('条件が「すべて」「不問」のみのフィルタカードは作成できません。', btnAdd);
              }catch(_){
                alert('条件が「すべて」「不問」のみのフィルタカードは作成できません。');
                try{ btnAdd.focus(); }catch(_){}
              }
              btnAdd.disabled = false;
              return;
            }
          }

          // ② 保存健全性チェック（保存領域の存在保証＆例外安全化）
          //    - _rulesData 本体／各配列が欠けていてもここで初期化
          //    - 保存〜再描画は try/catch/finally で囲ってUXを担保
          try{
            if (!_rulesData || typeof _rulesData !== 'object'){
              window._rulesData = { nec:[], wep:[], amr:[] };
            } else {
              if (!Array.isArray(_rulesData.nec)) _rulesData.nec = [];
              if (!Array.isArray(_rulesData.wep)) _rulesData.wep = [];
              if (!Array.isArray(_rulesData.amr)) _rulesData.amr = [];
            }

            // （既存のカード収集→生成→push→保存→再描画の処理はこの try 内にそのまま残してください）
            // 例：_rulesData[kind].push(newRule); saveRules(); renderCards(kind);

          } catch(err){
            console.error('[DBE] add-card: save/render failed', err);
            try{
              dbeShowOkDialog('保存エラー','カードの保存または再描画に失敗しました。もう一度お試しください。');
            }catch(_){}
            // 失敗時：ここで終了（ボタンは finally で復帰）
            return;
          } finally {
            // 多重クリック解除
            btnAdd.disabled = false;
          }

          if (kind==='nec'){
            // ネックレス専用の収集（IDベースで明確に取得）
            // grade
            let grade = null;
            const ckAllGrade = card.querySelector(`#fc-${kind}-grade-all`);
            if (ckAllGrade && ckAllGrade.checked){
              grade = { all:true };
            } else {
              const picks = [];
              ['プラチナ','金','銀','青銅','銅'].forEach(n=>{
                const c = card.querySelector(`#fc-${kind}-grade-${n}`);
                if (c && c.checked) picks.push(n);
              });
              if (picks.length>0) grade = { list:picks };
            }
            // prop count（0〜7 / 以上・未満）※ Buff + DeBuff の合計
            let prop = null;
            {
              const ckAll = card.querySelector(`#fc-${kind}-prop-all`);
              if (ckAll && ckAll.checked){
                prop = { all:true };
              } else {
                const numEl = card.querySelector(`#fc-${kind}-prop-num`);
                const opEl  = card.querySelector(`#fc-${kind}-prop-op`);
                const num = Number((numEl?.value||'').trim());
                const op  = (opEl?.value||'').trim();
                if (Number.isFinite(num) && op){ prop = { num, op }; }
              }
            }
            // debuff count（0〜7 / 以上・未満）
            let debuff = null;
            {
              const ckAll = card.querySelector(`#fc-${kind}-debuff-all`);
              if (ckAll && ckAll.checked){
                debuff = { all:true };
              } else {
                const numEl = card.querySelector(`#fc-${kind}-debuff-num`);
                const opEl  = card.querySelector(`#fc-${kind}-debuff-op`);
                const num = Number((numEl?.value||'').trim());
                const op  = (opEl?.value||'').trim();
                if (Number.isFinite(num) && op){ debuff = { num, op }; }
              }
            }
            // delta%
            let delta = null;
            {
              const ckAll = card.querySelector(`#fc-${kind}-delta-all`);
              if (ckAll && ckAll.checked){
                delta = { all:true };
              } else {
                const val = (card.querySelector(`#fc-${kind}-delta-val`)?.value||'').trim();
                const op  = (card.querySelector(`#fc-${kind}-delta-op`)?.value||'').trim();
                if (val && op){ delta = { value:val, op }; }
              }
            }
            const rule = {
              type: mode,
              grade,
              prop,
              debuff,
              delta,
              // 一覧の第2列は label に任意整形文字列を流用（武器/防具のような細分バッジは使わない）
              label: [
                '《グレード》' + (grade ? (grade.all ? '不問' : `${(grade.list||[]).join('')}`) : '指定なし'),
                prop   ? ('《プロパティ数》' + (prop.all   ? '不問' : `${prop.num}${prop.op}`))     : '《プロパティ数》指定なし',
                debuff ? ('《DeBuff》' + (debuff.all ? '不問' : `${debuff.num}${debuff.op}`)) : '《DeBuff》指定なし',
                delta  ? ('《増減値》' + (delta.all  ? '不問' : `${delta.value}${delta.op}`))  : '《増減値》指定なし'
              ].join('／')
            };
            const target = _rulesData.nec;
            target.push(rule);
            try { if (typeof saveRulesToStorage==='function') saveRulesToStorage(); } catch(_e){}
            renderCards(kind);
            btnInit.click();
            return;
          }
          // ここから従来（武器/防具）の追加処理
          let rarity = null;
          if (!stateRarity.all){
            rarity = Array.from(stateRarity.picks);
            if (rarity.length===0) rarity = null;
          }
          let nameObj = { mode:'all', keywords:'' };
          if (!nameState.all){
            const raw = (nameInput.value||'').trim();
            if (/[,、，\/|｜]/.test(raw)){
              alert('区切り文字にセミコロン「；」以外は使用できません。');
              return;
            }
            if (raw){
              const norm = raw.replace(/[；;]+/g,';').split(';').map(s=>s.trim()).filter(Boolean).join(';');
              nameObj = { mode:'spec', keywords:norm };
            }
          }
          const extra = {};
          if (!compState.all){
            const v = (compInput.value||'').trim();
            const b = compSel.value||'';
            if (v && b) extra[ kind==='wep' ? 'spd' : 'wt' ] = { value:v, border:b };
          }
          // 追加：minATK/maxATK（武器） or minDEF/maxDEF（防具）
          if (kind==='wep'){
            if (minStatState && !minStatState.all){
              const v = (minStatInput?.value||'').trim();
              const b = (minStatSel?.value||'').trim();
              if (v && b) extra.minATK = { value:v, border:b };
            }
            if (maxStatState && !maxStatState.all){
              const v = (maxStatInput?.value||'').trim();
              const b = (maxStatSel?.value||'').trim();
              if (v && b) extra.maxATK = { value:v, border:b };
            }
          } else if (kind==='amr'){
            if (minStatState && !minStatState.all){
              const v = (minStatInput?.value||'').trim();
              const b = (minStatSel?.value||'').trim();
              if (v && b) extra.minDEF = { value:v, border:b };
            }
            if (maxStatState && !maxStatState.all){
              const v = (maxStatInput?.value||'').trim();
              const b = (maxStatSel?.value||'').trim();
              if (v && b) extra.maxDEF = { value:v, border:b };
            }
          }
          // 追加：CRIT（武器/防具）
          if (critState && !critState.all){
            const v = (critInput?.value||'').trim();
            const b = (critSel?.value||'').trim();
            if (v && b) extra.crit = { value:v, border:b };
          }
          let elmObj = { all:false, selected:[] };
          if (elemState.all){ elmObj = { all:true, selected:[] }; }
          else { elmObj.selected = Array.from(elemState.picks); }
          let mrmObj = { mode:'all' };
          if (!mrmState.all){
            const v = (mrmInput.value||'').trim();
            const b = mrmSel.value||'';
            if (v && b) mrmObj = { mode:'spec', value:v, border:b };
          }
          const rule = Object.assign({
            type: mode,
            fop: (fopState && (fopState.op==='AND' || fopState.op==='OR')) ? fopState.op : 'AND',
            rarity,
            name: nameObj,
            elm: elmObj,
            mrm: mrmObj
          }, extra);
          const target = (kind==='wep') ? _rulesData.wep : _rulesData.amr;
          if (isEdit && opts && typeof opts.editIndex === 'number' && opts.editIndex >= 0 && opts.editIndex < target.length){
            target[opts.editIndex] = rule;
          } else {
            target.push(rule);
          }
          try { if (typeof saveRulesToStorage==='function') saveRulesToStorage(); } catch(_e){}
          renderCards(kind);
          if (!isEdit){
            btnInit.click();
          } else {
            try{ if (opts && typeof opts.onClose === 'function') opts.onClose(); }catch(_e){}
          }
        });
      }
      // ★ 再編集モードでは、この下のフッター（保存/キャンセル）は表示しない
      if (isEdit){
        return card;
      }

      // ⑧ 見た目“枠線の外側”に出すフッター（案内＋保存/キャンセル）
      {
        const tip = document.createElement('div');
        tip.className = 'fc-note';
        tip.textContent = '編集を終えたら最後に「保存する」ボタンを押してください。';

        const ops = document.createElement('div');
        ops.className = 'fc-ops fc-ops--center';
        const btnSave2 = document.createElement('button'); btnSave2.textContent='保存する';
        const btnCancel2 = document.createElement('button'); btnCancel2.textContent='キャンセル';
        Object.assign(btnSave2.style,{fontSize:'0.9em',padding:'4px 10px',margin:'0 3em 1em 0'});
        Object.assign(btnCancel2.style,{fontSize:'0.9em',padding:'4px 10px',margin:'0 0 1em 0'});
        btnSave2.addEventListener('click', ()=>{ try{ if (typeof saveRulesToStorage==='function') saveRulesToStorage(); }catch(_e){} });
        btnCancel2.addEventListener('click', ()=>{
          const ov = document.getElementById('dbe-modal-overlay');
          const wnd = document.getElementById('dbe-W-Rules');
          if (wnd) wnd.style.display='none';
          if (ov) ov.style.display='none';
          document.body.style.overflow='';
        });
        ops.append(btnSave2, btnCancel2);

        // フッターを .fc-card の“外”に見せるため、別要素として返す
        const footer = document.createElement('div');
        footer.className = 'fc-footer';
        footer.append(tip, ops);

        // card と footer をまとめて返す（DocumentFragment OK）
        const frag = document.createDocumentFragment();
        frag.append(card, footer);
        return frag;
      }
    }

    // ─────────────────────────────────────────────
    // 新規カードフォームの組み立て + タブ切替
    // ─────────────────────────────────────────────
  function render(kind){
    // 下段をクリア
    areaForm.innerHTML = '';
    // ローカルビルダーで必ずフォームを構築
    try {
      const built = buildFilterForm(kind);
      if (built) areaForm.appendChild(built);
    } catch(err){
      // フォームが作れない場合でも上段一覧は描画する
      console.warn('[DBE] buildFilterForm failed:', err);
    }

    // 上段の既存カードを更新
    renderCards(kind);

    // タブの見た目を更新
    [tabN, tabW, tabA].forEach(b => b.style.background = '');
    (kind === 'nec' ? tabN : (kind === 'wep' ? tabW : tabA)).style.background = '#eef';
  }
    tabN.addEventListener('click', () => render('nec'));
    tabW.addEventListener('click', () => render('wep'));
    tabA.addEventListener('click', () => render('amr'));

    // 初期表示：武器
    render('wep');

    // 保存 / キャンセル
    if (typeof saveRulesToStorage === 'function') {
      btnSave.addEventListener('click', () => {
        try { saveRulesToStorage(); } catch (_e) { /* noop */ }
      });
    }
    btnCancel.addEventListener('click', () => {
      const wnd  = document.getElementById('dbe-W-Rules');
      const ov = document.getElementById('dbe-modal-overlay');
      if (wnd)  wnd.style.display  = 'none';
      if (ov) ov.style.display = 'none';
      document.body.style.overflow = '';
    });

    // レイアウト用グリッド（ウィンドウの幅制御は既存スタイルに合わせる）
    const grid = document.createElement('div');
    Object.assign(grid.style, {
      maxWidth:'min(97svw, 860px)',
      minWidth:'min(92svw, 560px)',
      display:'grid',
      gap:'8px'
    });
    grid.append(titleEl, noteEl, opsEl, tabsEl, bodyEl);
    wrap.appendChild(grid);
    return wrap;
  }
  // ============================================================
  // △ここまで△ 新フォーム（《フィルタカード》新規作成フォーム）モーダル内容を構築
  // ============================================================

  // 〓〓〓 進捗HUD（右上の小パネル）〓〓〓
  const DBE_PROGRESS = { timer:null };
  function ensureProgressHud(){
    let hud = document.getElementById('dbe-progress-hud');
    if (hud) return hud;
    hud = document.createElement('div');
    hud.id = 'dbe-progress-hud';
    Object.assign(hud.style, {
      position:'fixed', top:'10px', right:'10px', zIndex: '1000002',
      background:'rgba(0,0,0,0.75)', color:'#fff', padding:'8px 10px',
      borderRadius:'8px', fontSize:'12px', lineHeight:'1.4',
      boxShadow:'0 2px 6px rgba(0,0,0,0.25)', pointerEvents:'none'
    });
    const title = document.createElement('div');
    title.textContent = 'DBE 進捗';
    title.style.fontWeight = 'bold';
    title.style.marginBottom = '4px';

    body.className = 'body';
    body.textContent = '準備中…';
    hud.append(title, body);
    document.body.appendChild(hud);
    return hud;
  }
  function tickProgressHud(){
    const hud = document.getElementById('dbe-progress-hud');
    if (!hud) return;
    const body = hud.querySelector('.body');
    const S = (typeof DBE_CHEST==='object' && DBE_CHEST) ? DBE_CHEST : {};
    const stage = S.stage || 'idle';
    const ql = Array.isArray(S.qLock) ? S.qLock.length : 0;
    const qr = Array.isArray(S.qRecycle) ? S.qRecycle.length : 0;
    const left = (S.left!=null) ? S.left : (S.unlimited ? '∞' : 0);
    const did = (S.total!=null && S.left!=null) ? (S.total - S.left) : '';
    body.textContent =
      `Stage: ${stage}  /  Lock残: ${ql}  /  分解残: ${qr}` +
      `  /  ループ残: ${left}` + (did!=='' ? `（実行:${did}）` : '');
  }
  function startProgressHud(){
    ensureProgressHud();
    try{ clearInterval(DBE_PROGRESS.timer); }catch(_){}
    DBE_PROGRESS.timer = setInterval(tickProgressHud, 300);
    tickProgressHud();
  }
  function stopProgressHud(){
    try{ clearInterval(DBE_PROGRESS.timer); }catch(_){}
    DBE_PROGRESS.timer = null;
    const hud = document.getElementById('dbe-progress-hud');
    if (hud) hud.remove();
  }

  // 互換ヘルパ: 「決定／初期化」ボタン生成
  // 既存の makeDecideReset が定義されていればそれを流用。無ければフォールバック実装を使う。
  const makeDecideResetLocal = (typeof makeDecideReset === 'function')
    ? makeDecideReset
    : function(onDecide, onReset){
        const node = document.createElement('div');
        Object.assign(node.style, {
          display:'flex', gap:'8px', alignItems:'center', marginTop:'6px', flexWrap:'wrap'
        });
        const btnOk  = document.createElement('button'); btnOk.type='button';  btnOk.textContent  = '決定';
        const btnClr = document.createElement('button'); btnClr.type='button'; btnClr.textContent = '初期化';
        [btnOk, btnClr].forEach(b=>Object.assign(b.style,{fontSize:'0.9em',padding:'4px 10px'}));
        btnOk.addEventListener('click',(err)=>{ e.preventDefault(); try{ onDecide && onDecide(); } catch(err){ console.error('[DBE] decide error:', err); }});
        btnClr.addEventListener('click',(err)=>{ e.preventDefault(); try{ onReset  && onReset();  } catch(err){ console.error('[DBE] reset  error:', err); }});
        node.append(btnOk, btnClr);
        return node;
      };

  // 〓〓〓 共通ヘルパ：エレメント複数選択（「不問」対応）〓〓〓
  function rowElmChecks(baseId){
    const node=document.createElement('div');
    Object.assign(node.style,{display:'flex',gap:'10px',alignItems:'center',flexWrap:'wrap'});
    // 《Element》ラベルを先頭に追加
    const lab=document.createElement('span');
    lab.textContent='《Element》';
    Object.assign(lab.style,{fontWeight:'bold',fontSize:'1.1em'});
    node.appendChild(lab);
    const names=['不問','||','火','氷','雷','風','地','水','光','闇','なし'];
    const boxes=[];
    names.forEach(n=>{
      if (n==='||'){ const sep=document.createElement('span'); sep.textContent='||'; node.append(sep); return; }
      const id = baseId+'-'+n;
      const c=document.createElement('input'); c.type='checkbox'; c.id=id;
      const lb=document.createElement('label'); lb.htmlFor=id; lb.append(document.createTextNode(' '+n));
      boxes.push({n,c}); node.append(c,lb);
    });
    const all = boxes.find(b=>b.n==='不問').c;
    const rests = boxes.filter(b=>b.n!=='不問');
    const sync = ()=>{
      if (all.checked){ rests.forEach(({c})=>{ c.checked=true; c.disabled=true; }); }
      else { rests.forEach(({c})=>{ c.disabled=false; }); }
    };
    all.addEventListener('change', sync);
    const data = ()=>({
      all: all.checked,
      selected: rests.filter(({c})=>c.checked).map(({n})=>n)
    });
    const label = ()=>{
      const picked = rests.filter(({c})=>c.checked).length;
      return (all.checked || rests.every(({c})=>c.checked)) ? '不問' : `属性${picked}種`;
    };
    return {node, data, label};
  }

  // 〓〓〓 ルール永続化ヘルパ 〓〓〓
  const RULES_STORE_KEY = 'dbe-rules-v1';
  let _rulesSaved = null; // 直近に保存されたスナップショット
  function loadRulesFromStorage(){
    try{
      const raw = dbeStorage.getItem(RULES_STORE_KEY);
      if (raw){
        const obj = JSON.parse(raw);
        if (obj && typeof obj === 'object' && obj.nec && obj.wep && obj.amr){
          _rulesData = obj;
          _rulesSaved = JSON.parse(JSON.stringify(_rulesData));
          return obj;
        }
      }
    }catch(err){
      console.warn('[DBE] loadRulesFromStorage error:', err);
    }
    // 保存がない／失敗した場合は現行を基準にスナップショット化
    _rulesSaved = JSON.parse(JSON.stringify(_rulesData));
    return _rulesData;
  }
  function saveRulesToStorage(){
    try{
      // 配列保証（欠損していてもここで自己修復）
      if (!_rulesData || typeof _rulesData !== 'object'){
        window._rulesData = { nec:[], wep:[], amr:[] };
      } else {
        if (!Array.isArray(_rulesData.nec)) _rulesData.nec = [];
        if (!Array.isArray(_rulesData.wep)) _rulesData.wep = [];
        if (!Array.isArray(_rulesData.amr)) _rulesData.amr = [];
      }
      // 保存（JSON.stringify エラーや容量超過も捕捉）
      const payload = JSON.stringify(_rulesData);
      dbeStorage.setItem(RULES_STORE_KEY, payload);
      return true;
    } catch(err){
      console.error('[DBE] saveRules failed', err);
      try{
        dbeShowOkDialog('保存エラー','ルールの保存に失敗しました。もう一度お試しください。');
      }catch(_){}
      return false;
    }
  }  // 起動時に一度ロード（ページ再読込後でも復元できるように）
  loadRulesFromStorage();

  // ============================================================
  // ▽ここから▽ openRulesModal 本流
  // ============================================================
  function openRulesModal(){
    try{
      // 背景スクロール抑止
      document.body.style.overflow = 'hidden';

      // 透過オーバーレイ
      let overlay = document.getElementById('dbe-modal-overlay');
      if (!overlay){
        overlay = document.createElement('div');
        overlay.id = 'dbe-modal-overlay';
        Object.assign(overlay.style, {
          position:'fixed', inset:'0', background:'rgba(0,0,0,0.45)', zIndex:'1000000'
        });
        document.body.appendChild(overlay);
      } else {
        overlay.style.display = 'block';
      }

      // Rules 用の共通ウィンドウシェル（×ボタンあり）
      const wnd = ensureWindowShell('dbe-W-Rules');

      // ×ボタン以外をクリア（既存の旧ビルダー等は完全に撤去する）
      Array.from(wnd.children).forEach((ch, i) => { if (i > 0) ch.remove(); });

      // 新ビルダー DOM を構築して挿入（※必ず新カードビルダーのみ）
      const content = buildNewFilterModalContent();
      if (!content){
        // ここに来る場合はビルダーが読み込まれていない。旧フォールバックは使わず明示的に例外にする
        throw new Error('Filter-card builder was not created.');
      }
      wnd.appendChild(content);

      // 表示
      wnd.style.display = 'inline-block';

      // ×ボタン (先頭ボタン) で閉じる時の後始末
      const closeBtn = wnd.querySelector('button');
      if (closeBtn && !closeBtn.__dbeBound){
        closeBtn.__dbeBound = true;
        closeBtn.addEventListener('click', ()=>{
          const ov = document.getElementById('dbe-modal-overlay');
          if (ov) ov.style.display = 'none';
          document.body.style.overflow = '';
        });
      }
    }catch(err){
      console.error('[DBE] failed to open rules modal:', err);
      // 失敗時でも UI が固まらないよう最低限の復帰
      const ov = document.getElementById('dbe-modal-overlay');
      if (ov) ov.style.display = 'none';
      document.body.style.overflow = '';
    }
  }
  // ============================================================
  // △ここまで△ openRulesModal 本流
  // ============================================================

  // 〓〓〓 Recycle ウィンドウに「全て分解ボタンを隠す」UIを挿入（Settingsからの移植） 〓〓〓
  function ensureHideAllControlInRecycle(){
    const rWnd = document.getElementById('dbe-W-Recycle');
    const rSec = document.getElementById('dbe-panel0-Recycle');
    if (!rWnd || !rSec) return;

    // 既に作成済みならスキップ
    if (document.getElementById('dbe-recycle-hideAll-container')) return;

    // 「『全て分解』まきこみアラート」コンテナ（直下の子）をアンカーにする
    const alertBox = rSec.querySelector('#dbe-recycle-bulk-alert') || null;

    // UIコンテナを作成
    const box = document.createElement('div');
    box.id = 'dbe-recycle-hideAll-container';
    box.style.cssText = 'margin:4px 0 8px 0; display:flex; align-items:center; gap:6px;';

    const ck = document.createElement('input');
    ck.type = 'checkbox';
    // Settings 側と同一の安定IDを使用（DBE_KEYS.hideAllBtn.id）
    ck.id = 'dbe-prm-panel0-check-hide-RyclUnLck';
    try { ck.checked = readBool('hideAllBtn'); } catch (err) { ck.checked = false; }

    const lb = document.createElement('label');
    lb.htmlFor = ck.id;
    lb.textContent = 'ページの「全て分解する」ボタンを隠す';
    lb.style.cssText = 'font-size:0.95em;';

    box.append(ck, lb);
    if (alertBox && alertBox.parentNode === rSec){
      // 直下の子ならその直前へ
      rSec.insertBefore(box, alertBox);
    } else if (alertBox && alertBox.parentNode){
      // 念のため：親が rSec でない場合も「コンテナの直前」に差し込む
      alertBox.parentNode.insertBefore(box, alertBox);
    } else {
      // フォールバック：Recycle セクションの先頭
      rSec.prepend(box);
    }

    // 対象ボタンの一括適用ヘルパ（ページ上の本物だけを対象にする）
    function applyHideAllBtnToPage(on){
      // Recycle ウィンドウ内ではなく、ページ上のフォームボタンを厳密に特定
      document.querySelectorAll('form[action$="/recycleunlocked"] > button')
        .forEach(btn=>{
          // rSec（Recycle ウィンドウ）外の「ページ本体」のボタンのみ隠す
          if (!rSec.contains(btn)) btn.style.display = on ? 'none' : '';
        });
    }
    // 変更イベント：保存＆即時反映（writeBool を使用してキー整合）
    ck.addEventListener('change', ()=>{
      try { writeBool('hideAllBtn', ck.checked); } catch (err) { /* noop */ }
      applyHideAllBtnToPage(ck.checked);
    });
    // Settingsウィンドウに旧UIが残っていたら撤去
    const oldInSettings = document.querySelector('#dbe-W-Settings #dbe-prm-panel0-check-hide-RyclUnLck');
    if (oldInSettings){
      const wrap = oldInSettings.closest('label, div') || oldInSettings.parentElement;
      if (wrap) wrap.remove(); else oldInSettings.remove();
    }
    // 現在値をページに反映
    try { applyHideAllBtnToPage(readBool('hideAllBtn')); } catch (err) { applyHideAllBtnToPage(false); }
  }

  // --- 名称セルの装備種＋クラス行（2行目）の表示/非表示を切替 ---
  //   クラスや style 文字列に依存せず、各テーブルの 1 列目の
  //   「2つ目の <span>（= 情報行）」と、その直前の <br> を対象とする。
  function dbeTargetTableIds(targetTableId){
    return targetTableId
      ? [targetTableId]
      : ['necklaceTable','weaponTable','armorTable'];
  }

  function toggleNameSubLine(hide, targetTableId) {
    dbeTargetTableIds(targetTableId).forEach(id => {
      const table = document.getElementById(id);
      if (!table) return;
      table.querySelectorAll('tbody > tr > td:first-child').forEach(cell => {
        if (!(cell && cell.querySelectorAll)) return;
        const spans = cell.querySelectorAll('span');
        const infoSpan = (spans.length >= 2) ? spans[1] : null; // 2行目：装備種＋クラス行
        if (infoSpan){
          infoSpan.style.display = hide ? 'none' : '';
          // 直前の <br> だけ切替（空行抑止）
          const prev = infoSpan.previousElementSibling;
          if (prev && prev.tagName === 'BR'){
            prev.style.display = hide ? 'none' : '';
          } else {
            // 後方互換：cell 内の先頭 <br> を対象
            const firstBr = cell.querySelector('br');
            if (firstBr) firstBr.style.display = hide ? 'none' : '';
          }
        }
      });
    });
  }

  // --- necklaceTableの増減列の表示/非表示を切替 ---
  function toggleDeltaColumn(show) {
    document.querySelectorAll(`.${columnIds['necklaceTable']['増減']}`)
      .forEach(el => el.style.display = show ? '' : 'none');
  }

  // --- 「錠／解錠」列の列インデックスを動的に検出 ---
  function findLockColumnIndex(table){
    try{
      const head = table.tHead && table.tHead.rows && table.tHead.rows[0];
      const body = table.tBodies && table.tBodies[0];
      if (!head || !body) return -1;
      // キャッシュ
      if (table.dataset.lockColIdx && table.dataset.lockColIdx !== 'NaN'){
        const cached = Number(table.dataset.lockColIdx);
        if (Number.isInteger(cached) && cached >= 0 && cached < head.cells.length) {
          const th = head.cells[cached];
          const lockKey = columnIds?.[table.id]?.['解'] || '';
          const looksLockHeader =
            (lockKey && th && th.classList && th.classList.contains(lockKey)) ||
            (lockKey && th && th.dataset && th.dataset.colkey === lockKey) ||
            (lockKey && th && th.getAttribute && th.getAttribute('data-colkey') === lockKey) ||
            ((th && th.textContent || '').trim() === '解');
          if (looksLockHeader) return cached;

          // ID列の追加などで列位置が変わると、古いキャッシュが「装」列などを指すことがある。
          // 誤って「装」ヘッダーを非表示にしないよう、信用できないキャッシュは破棄して再探索する。
          try{ delete table.dataset.lockColIdx; }catch(_){ table.dataset.lockColIdx = ''; }
        }
      }
      const colCount = head.cells.length;
      const rows = Array.from(body.rows).slice(0, 80); // サンプル走査
      let bestIdx = -1, bestHit = 0;
      for (let c=0; c<colCount; c++){
        let hits = 0;
        for (const r of rows){
          const cell = r.cells[c]; if (!cell) continue;
          // 「解錠」「ロック」のリンクや表記を広めに判定
          if (cell.querySelector('a[href*="/unlock/"],a[href*="/lock/"]')) { hits++; continue; }
          const t = cell.textContent || '';
          if (/\[?\s*解錠\s*\]?/.test(t) || /\[?\s*ロック\s*\]?/.test(t)) hits++;
        }
        if (hits > bestHit){ bestHit = hits; bestIdx = c; }
      }
      if (bestIdx >= 0) table.dataset.lockColIdx = String(bestIdx);
      return bestIdx;
    }catch(_){ return -1; }
  }

  // --- 名称欄バッジ（🔰🔒）基盤：右寄せで整列するホストを用意し、個別バッジを管理 ---
  function ensureNameBadgeHost(nameCell){
    if (!nameCell) return null;
    nameCell.style.position = nameCell.style.position || 'relative';
    let host = nameCell.querySelector('.dbe-name-badges');
    if (!host){
      host = document.createElement('span');
      host.className = 'dbe-name-badges';
      // 右上寄せで重ねる（フレックスで右詰め）
      host.style.cssText = [
        'position:absolute', 'right:4px', 'top:0',
        'display:flex','gap:4px',
        'align-items:flex-start','justify-content:flex-end',
        'pointer-events:none','font-size:1.2em',
        // 絵文字が折返さないように最低限の制御
        'white-space:nowrap'
      ].join(';');
      nameCell.appendChild(host);
    }
    return host;
  }

  function setBadge(nameCell, type, show){
    const host = ensureNameBadgeHost(nameCell);
    if (!host) return;
    const CLS = {
      new:     'dbe-badge-new',
      lock:    'dbe-badge-lock',
    };
    const TXT = {
      new:     '🔰',
      lock:    '🔒',
    };
    const ORDER = {
      // 並び順：🔰 → 🔒
      new:     '1',
      lock:    '2',
    };
    const cls = CLS[type];
    if (!cls) return;
    let el = host.querySelector('.' + cls);
    if (show){
      if (!el){
        el = document.createElement('span');
        el.className = cls;
        el.textContent = TXT[type] || '';
        el.style.cssText = 'order:'+ORDER[type]+';';
        host.appendChild(el);
      }
    } else {
      if (el) el.remove();
      // ホストが空になったら掃除
      if (!host.querySelector(':scope > span')) host.remove();
    }
  }

  // バッジのユーティリティ（外からも使えるように最低限公開）
  window.DBE_setNameBadge = {
    newbie : (td, on)=> setBadge(td,'new',!!on),
    lock   : (td, on)=> setBadge(td,'lock',!!on),
  };

  function findHeaderIndexByText(table, candidates){
    const thead = table.tHead; if (!thead) return -1;
    const tr = thead.rows[0]; if (!tr) return -1;
    const texts = Array.from(tr.cells).map(th=> (th.textContent||'').trim());
    for (let i=0;i<texts.length;i++){
      const t = texts[i];
      if (candidates.some(c=> t===c || t.includes(c))) return i;
    }
    return -1;
  }

  function getNameCell(row){
    return row && row.cells && row.cells[0] || null;
  }

  // --- 名称セルから「表示用のアイテム名」だけを抽出（装備ダイアログ用） ---
  // 例）<span style="font-weight:600;">金ネックレス</span> の「金ネックレス」だけを拾う
  function pickPrimaryItemNameFromNameTd(nameTd){
    try{
      if (!nameTd) return '';
      // 1) 太字（font-weight:600 付近）の span を優先
      const spans = Array.from(nameTd.querySelectorAll('span'));
      for (const sp of spans){
        // バッジ類は除外
        if (sp.closest('.dbe-name-badges')) continue;
        const styleText = String(sp.getAttribute('style')||'').replace(/\s+/g,'').toLowerCase();
        const fw = String(sp.style && sp.style.fontWeight || '').toLowerCase();
        if (styleText.includes('font-weight:600') || styleText.includes('font-weight:700') || fw === '600' || fw === '700' || fw === 'bold'){
          const t = String(sp.textContent||'').trim();
          if (t) return t;
        }
      }
      // 2) 太字が取れない場合は、最初の span（バッジ以外）を採用
      for (const sp of spans){
        if (sp.closest('.dbe-name-badges')) continue;
        const t = String(sp.textContent||'').trim();
        if (t) return t;
      }
      // 3) 最終フォールバック：セルのテキスト（正規化）
      return normalizeItemName(nameTd.textContent || '');
    }catch(_){
      try{ return normalizeItemName(nameTd ? nameTd.textContent : ''); }catch(_e){ return ''; }
    }
  }

  // --- 名称セルからレアリティ（UR/SSR/SR/R/N）を抽出（武器・防具の装備ダイアログ用） ---
  // 例）「【武器】[R]」「【防具】 [SR]」などの textContent から [R] / [SR] を拾う
  function pickRarityFromNameTd(nameTd){
    try{
      const raw = String(nameTd ? nameTd.textContent : '');
      const m = raw.match(/\[(UR|SSR|SR|R|N)\]/);
      return m ? m[1] : '';
    }catch(_){
      return '';
    }
  }

  // --- 名称セルから「表示用のアイテム名」だけを抽出（装備ダイアログ用） ---
  // 例）<span style="font-weight:600;">金ネックレス</span> の「金ネックレス」だけを拾う
  function pickPrimaryItemNameFromNameTd(nameTd){
    try{
      if (!nameTd) return '';
      // 1) 太字（font-weight:600 付近）の span を優先
      const spans = Array.from(nameTd.querySelectorAll('span'));
      for (const sp of spans){
        // バッジ類は除外
        if (sp.closest('.dbe-name-badges')) continue;
        const styleText = String(sp.getAttribute('style')||'').replace(/\s+/g,'').toLowerCase();
        const fw = String(sp.style && sp.style.fontWeight || '').toLowerCase();
        if (styleText.includes('font-weight:600') || styleText.includes('font-weight:700') || fw === '600' || fw === '700' || fw === 'bold'){
          const t = String(sp.textContent||'').trim();
          if (t) return t;
        }
      }
      // 2) 太字が取れない場合は、最初の span（バッジ以外）を採用
      for (const sp of spans){
        if (sp.closest('.dbe-name-badges')) continue;
        const t = String(sp.textContent||'').trim();
        if (t) return t;
      }
      // 3) 最終フォールバック：セルのテキスト（正規化）
      return normalizeItemName(nameTd.textContent || '');
    }catch(_){
      try{ return normalizeItemName(nameTd ? nameTd.textContent : ''); }catch(_e){ return ''; }
    }
  }

  // --- 名称セル（1列目）に🔒を右寄せ表示／削除（「解錠」行のみ対象） ---
  function applyPadlockMarkers(show, targetTableId){
    const BADGE = dbeEnsureNameBadgeApi();
    dbeTargetTableIds(targetTableId).forEach(id=>{
      const table = document.getElementById(id); if (!table) return;
      const body  = table.tBodies && table.tBodies[0]; if (!body) return;
      const lockIdx = findLockColumnIndex(table); if (lockIdx < 0) return;
      Array.from(body.rows).forEach(row=>{
        const lockCell = row.cells[lockIdx]; if (!lockCell) return;
        const isLocked = !!lockCell.querySelector('a[href*="/unlock/"]') || /\b解錠\b/.test(lockCell.textContent||'');
        const nameCell = row.querySelector('td:first-child'); if (!nameCell) return;
        // バッジ基盤で描画・削除
        window.DBE_setNameBadge.lock(nameCell, !!(show && isLocked));
      });
    });
  }

  // --- 「錠／解錠」列の表示/非表示を切替（ヘッダー含む） ---
  function toggleLockColumn(hide, targetTableId){
    dbeTargetTableIds(targetTableId).forEach(id=>{
      const table = document.getElementById(id); if (!table) return;
      const head = table.tHead && table.tHead.rows && table.tHead.rows[0];
      const body = table.tBodies && table.tBodies[0];
      if (!head || !body) return;

      // 「錠／解錠」列だけを隠す設定なので、ID列追加前の古いキャッシュ等で
      // 誤って「装」列が非表示になっていた場合は、ここで必ず復帰させる。
      try{
        const equpKey = columnIds?.[id]?.['装'];
        if (equpKey){
          table.querySelectorAll(`.${equpKey}, [data-colkey="${equpKey}"]`).forEach(el=>{
            el.style.display = '';
          });
        }
        const equpIdxByText = Array.from(head.cells || []).findIndex(th => (th.textContent || '').trim() === '装');
        if (equpIdxByText >= 0){
          const th = head.cells[equpIdxByText];
          if (th) th.style.display = '';
          Array.from(body.rows || []).forEach(r=>{
            const td = r.cells[equpIdxByText];
            if (td) td.style.display = '';
          });
        }
      }catch(_){}

      const idx = findLockColumnIndex(table);
      if (idx < 0) return;
      // ヘッダー
      const th = head.cells[idx]; if (th) th.style.display = hide ? 'none' : '';
      // ボディ
      Array.from(body.rows).forEach(r=>{
        const td = r.cells[idx]; if (td) td.style.display = hide ? 'none' : '';
      });
    });
    // マーカーの反映
    applyPadlockMarkers(hide, targetTableId);
  }

  function recordClickedCell(cell, table){
    let cellId = cell.id;
    if (!cellId) {
      const rows = Array.from(table.tBodies[0].rows);
      const rowIndex = rows.indexOf(cell.parentElement);
      const cellIndex = Array.prototype.indexOf.call(cell.parentElement.cells, cell);
      cellId = `${table.id}-r${rowIndex}-c${cellIndex}`;
      cell.id = cellId;
    }
    lastClickedCellId = cellId;
    sessionStorage.setItem(anchorKey, cellId);
  }

  function scrollToAnchorCell(){
    if (!lastClickedCellId) return;
    const el = document.getElementById(lastClickedCellId);
    if (el) {
      const r = el.getBoundingClientRect();
      const y = window.pageYOffset + r.top + r.height/2 - window.innerHeight/2;
      window.scrollTo({ top: y, behavior: 'auto' });
    }
    lastClickedCellId = null;
    sessionStorage.removeItem(anchorKey);
  }

  function clearAnchorCellMemory(){
    lastClickedCellId = null;
    sessionStorage.removeItem(anchorKey);
  }

  function dbeEscapeRegExp(s){
    return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function dbeFindItemRowById(itemId){
    const id = String(itemId || '').trim();
    if (!id) return null;
    const re = new RegExp(
      '/(?:lock|unlock|equip|recycle|' +
      'modify/(?:weapon|armor|necklace)/(?:view|reroll)/)' +
      dbeEscapeRegExp(id) +
      '(?:$|[?#])'
    );
    for (const tableId of tableIds) {
      const table = document.getElementById(tableId);
      if (!table) continue;
      const links = Array.from(table.querySelectorAll('a[href]'));
      const hit = links.find(a=>{
        const href = String(a.getAttribute('href') || a.href || '');
        return re.test(href);
      });
      const tr = hit ? hit.closest('tr') : null;
      if (tr) return tr;
    }
    return null;
  }

  function dbeScrollToItemRow(itemId){
    const tr = dbeFindItemRowById(itemId);
    if (!tr) return false;
    const r = tr.getBoundingClientRect();
    const y = window.pageYOffset + r.top + r.height/2 - window.innerHeight/2;
    window.scrollTo({ top: Math.max(0, y), behavior: 'auto' });
    try{
      const oldOutline = tr.style.outline;
      const oldOutlineOffset = tr.style.outlineOffset;
      tr.style.outline = '3px solid #FF6600';
      tr.style.outlineOffset = '-3px';
      setTimeout(()=>{
        try{
          tr.style.outline = oldOutline;
          tr.style.outlineOffset = oldOutlineOffset;
        }catch(_){}
      }, 1800);
    }catch(_){}
    return true;
  }

  function dbeReloadPageAndRestoreItemRow(itemId){
    try{
      const id = String(itemId || '').trim();
      if (id) sessionStorage.setItem(lockReloadItemAnchorKey, id);
    }catch(_){}
    try{ dbeHideOverlay(); }catch(_){}
    try{ hideOverlay(); }catch(_){}
    location.reload();
  }

  function showOverlay(text){
    let ov = document.getElementById(overlayId);
    if (!ov) {
      ov = document.createElement('div');
      ov.id = overlayId;
      Object.assign(ov.style, {
        position:'fixed',top:0,left:0,width:'100%',height:'100%',
        backgroundColor:'rgba(0,0,0,0.5)',color:'#fff',
        display:'flex',justifyContent:'center',alignItems:'center',
        fontSize:'1.5em',zIndex:9999
      });
      document.body.appendChild(ov);
      chestDiag('overlay: created');
    }
    ov.textContent = text;
    ov.style.display = 'flex';
    ov.addEventListener('click', hideOverlay, { once:true });
  }

  function hideOverlay(){
    const ov = document.getElementById(overlayId);
    if (ov) ov.style.display = 'none';
  }

  // --- ネックレス「属性」列：通常表示ではDeBuff末尾を赤く、簡易表示ONでは「略称: ±数値%」へ置換 ---
  // --- 原案は 5ちゃんねる ID:YTtKPa4Z0 氏（https://kes.5ch.io/test/read.cgi/donguri/1726752559/63） ---
  function dbeFindNecklaceAttrColumnIndex(table){
    try{
      if (!table || !table.tHead || !table.tHead.rows || !table.tHead.rows[0]) return -1;
      const attrKey = columnIds?.necklaceTable?.['属性'] || 'necClm-StEf';
      return Array.from(table.tHead.rows[0].cells || []).findIndex(th=>{
        return (th.dataset && th.dataset.colkey === attrKey) ||
          (th.classList && th.classList.contains(attrKey)) ||
          ((th.textContent || '').trim() === '属性');
      });
    }catch(_){
      return -1;
    }
  }

  function dbeRenderNecklaceAttrListItem(li, raw, simple){
    try{
      if (!li) return;
      raw = String(raw || '').trim();
      if (!raw) return;

      // いったん元の1行へ戻してから再描画する（ON/OFF切替・再適用に強くする）
      li.textContent = raw;

      const m = raw.match(/^\[([^\]\+\-]+)([+-])\]\s*([^:]+):\s*(\d+)%\s+(.+)$/);
      if (simple && m){
        const abbr = m[1].trim();
        const sign = m[2];
        const value = m[4];

        li.textContent = '';
        li.appendChild(document.createTextNode(abbr + ': '));
        if (sign === '-'){
          const sp = document.createElement('span');
          sp.className = 'dbe-nec-attr-minus';
          sp.textContent = '-' + value + '%';
          li.appendChild(sp);
        } else {
          li.appendChild(document.createTextNode('+' + value + '%'));
        }
        return;
      }

      // 通常表示：DeBuff（[SPD-] 等）の末尾テキストだけ赤くする
      const parts = raw.split('% ');
      if (parts.length < 2) return;
      if (parts[0].includes('+]')) return;

      const head = parts[0] + '% ';
      const tail = parts.slice(1).join('% ').trim();
      if (!tail) return;

      li.textContent = '';
      li.appendChild(document.createTextNode(head));
      const sp = document.createElement('span');
      sp.className = 'dbe-nec-debuff';
      sp.textContent = tail;
      li.appendChild(sp);
    }catch(_){}
  }

  function dbeApplyNecklaceDebuffColoring(table){
    try{
      if (!table || !table.tHead || !table.tBodies || !table.tBodies[0]) return;
      if (table.id !== 'necklaceTable' && table.id !== 'necklaceEquipped') return;

      const attrIdx = dbeFindNecklaceAttrColumnIndex(table);
      if (attrIdx < 0) return;

      const simple = (typeof readBool === 'function') ? readBool('showSimpleNecAttr') : false;
      Array.from(table.tBodies[0].rows || []).forEach(row=>{
        const cell = row.cells[attrIdx];
        if (!cell) return;

        cell.querySelectorAll('ul:not([id]) > li').forEach(li=>{
          if (!li.dataset.dbeNecAttrOriginal){
            li.dataset.dbeNecAttrOriginal = (li.textContent || '').trim();
          }
          dbeRenderNecklaceAttrListItem(li, li.dataset.dbeNecAttrOriginal, simple);
        });
      });
    }catch(_){}
  }

  function dbeApplyAllNecklaceAttrDisplay(){
    try{
      ['necklaceEquipped','necklaceTable'].forEach(id=>{
        const table = document.getElementById(id);
        if (table) dbeApplyNecklaceDebuffColoring(table);
      });
    }catch(_){}
  }

  // --- ネックレス効果1行から増減値を抽出（通常表示／簡易表示の両対応） ---
  function dbeGetNecklaceAttrDeltaValue(li, buffList, debuffList){
    try{
      if (!li) return null;
      const raw = (li.dataset && li.dataset.dbeNecAttrOriginal)
        ? String(li.dataset.dbeNecAttrOriginal || '').trim()
        : String(li.textContent || '').trim();
      if (!raw) return null;

      const _buff   = Array.isArray(buffList)   ? buffList   : (Array.isArray(buffKeywords)   ? buffKeywords   : []);
      const _debuff = Array.isArray(debuffList) ? debuffList : (Array.isArray(debuffKeywords) ? debuffKeywords : []);

      // 通常表示: [DMG+]解き放たれた力: 16% 増幅された
      const mLong = raw.match(/^\[[^\]\+\-]+([+-])\]\s*[^:]+:\s*(\d+)%\s+(.+)$/);
      if (mLong){
        const sign = mLong[1];
        const value = parseInt(mLong[2], 10) || 0;
        const keyword = (mLong[3] || '').trim();
        if (_buff.includes(keyword)) return value;
        if (_debuff.includes(keyword)) return -value;
        // 未知文言でも、元の [略称+/-] の符号をフォールバックとして使う。
        return sign === '-' ? -value : value;
      }

      // 簡易表示: DMG: -14% / LUK: +13%
      const mSimple = raw.match(/:\s*([+-])\s*(\d+)%/);
      if (mSimple){
        const value = parseInt(mSimple[2], 10) || 0;
        return mSimple[1] === '-' ? -value : value;
      }
    }catch(_){}
    return null;
  }

  // --- [錠]/[解錠]セル背景色を適用 ---
  function dbeGetLockCellState(cell, opt){
    try{
      if (!cell) return null;
      const preferDom = !!(opt && opt.preferDom);
      if (!preferDom){
        if (cell.hasAttribute('released')) return 'released'; // [錠] = 未ロック
        if (cell.hasAttribute('secured'))  return 'secured';  // [解錠] = ロック済み
      }

      const a = cell.querySelector('a');
      const href = String(a ? (a.getAttribute('href') || a.href || '') : '');
      const onclick = String(a ? (a.getAttribute('onclick') || '') : '');
      const text = String(a ? (a.textContent || '') : (cell.textContent || '')).replace(/\s+/g, '');

      // クリック直後は公式 toggleLock がリンク文字列だけを書き換えるため、
      // 既存の secured/released 属性より、いま見えている [錠] / [解錠] を優先する。
      if (preferDom){
        if (text.includes('解錠')) return 'secured';
        if (text.includes('錠'))   return 'released';
      }

      // 公式改修前: href="/lock/..." / href="/unlock/..."
      if (href.includes('/lock/'))   return 'released';
      if (href.includes('/unlock/')) return 'secured';

      // 公式改修後: href="javascript:void(0);" + onclick="toggleLock(...)"
      // toggleLock は表示文字列を [錠] / [解錠] に差し替えるため、文字列で状態を判定する。
      if (/toggleLock\s*\(/.test(onclick) || /^javascript:/i.test(href)){
        if (text.includes('解錠')) return 'secured';
        if (text.includes('錠'))   return 'released';
      }

      // 最終フォールバック：リンク形式に依存せず、セル表示だけで判定する。
      if (text.includes('解錠')) return 'secured';
      if (text.includes('錠'))   return 'released';
    }catch(_){}
    return null;
  }

  function dbeApplyLockCellStateAttr(cell, state){
    try{
      if (!cell) return;
      cell.removeAttribute('secured');
      cell.removeAttribute('released');
      if (state === 'released') cell.setAttribute('released', '');
      if (state === 'secured')  cell.setAttribute('secured',  '');
    }catch(_){}
  }

  function dbeReapplyLockCellColorKeepingScroll(cell, opt){
    const sx = window.scrollX || window.pageXOffset || 0;
    const sy = window.scrollY || window.pageYOffset || 0;
    try{
      dbeApplyLockCellStateAttr(cell, dbeGetLockCellState(cell, opt));
      applyCellColors();
    }catch(_){}
    try{ window.scrollTo(sx, sy); }catch(_){}
    try{
      requestAnimationFrame(()=>{
        try{ window.scrollTo(sx, sy); }catch(_){}
      });
    }catch(_){
      try{ setTimeout(()=>window.scrollTo(sx, sy), 0); }catch(__){}
    }
  }

  function dbeReadableTextColorForBg(bg, fallback){
    try{
      const color = String(bg || '').trim();
      const m = color.match(/^#([0-9a-f]{6})$/i);
      if (!m) return fallback || '#000000';
      const hex = m[1];
      const r = parseInt(hex.slice(0,2),16), g = parseInt(hex.slice(2,4),16), b = parseInt(hex.slice(4,6),16);
      const lum = 0.299*r + 0.587*g + 0.114*b;
      return lum > 186 ? '#FF0000' : '#FFFFFF';
    }catch(_){
      return fallback || '#000000';
    }
  }

  function applyCellColors(){
    const unlockedColor = readStr('unlockedColor');
    const lockedColor   = readStr('lockedColor');
    tableIds.forEach(id=>{
      const table = document.getElementById(id);
      if (!table?.tHead || !table.tBodies?.[0]) return;

      // 「解」列インデックス
      // 公式HTML差し替え・ID列追加・ヘッダーclone後でも拾えるよう、既存の動的検出を優先する。
      let lockIdx = (typeof findLockColumnIndex === 'function') ? findLockColumnIndex(table) : -1;
      if (lockIdx < 0){
        const hdrs = table.tHead.rows[0].cells;
        lockIdx = Array.from(hdrs).findIndex(th=>th.classList.contains(columnIds[id]['解']));
      }
      if (lockIdx < 0) return;

      Array.from(table.tBodies[0].rows).forEach(row=>{
        const cell = row.cells[lockIdx];
        if (!cell) return;

        // released = 未ロック([錠])、secured = ロック済み([解錠])
        // href /lock 形式だけでなく、公式改修後の javascript:void(0)+toggleLock 形式にも対応する。
        const state = dbeGetLockCellState(cell);
        dbeApplyLockCellStateAttr(cell, state);

        const bg = (state === 'released') ? unlockedColor : lockedColor;
        cell.style.backgroundColor = bg;

        const txt = dbeReadableTextColorForBg(bg, (state === 'released') ? '#000000' : '#FFFFFF');
        cell.style.color = txt;
        const a = cell.querySelector('a');
        if (a) a.style.color = txt;
      });

      // ネックレス「属性」列：通常表示/簡易表示を反映
      if (id === 'necklaceTable') { try{ dbeApplyNecklaceDebuffColoring(table); }catch(_){} }

    });
  }











  // 〓〓〓 追加：アイテムID列の ON/OFF ▼ここから▼ 〓〓〓
  function toggleItemIdColumn(enabled){
    const triplets = [
      { tableId:'necklaceTable', itemKey:'necClm-ItemID', nameKey:'necClm-Name', equpKey:'necClm-Equp' },
      { tableId:'weaponTable',   itemKey:'wepClm-ItemID', nameKey:'wepClm-Name', equpKey:'wepClm-Equp' },
      { tableId:'armorTable',    itemKey:'amrClm-ItemID', nameKey:'amrClm-Name', equpKey:'amrClm-Equp' },
    ];
    for (const t of triplets){
      const table = document.getElementById(t.tableId);
      if (!table) continue;

      // すでに目的の状態なら何もしない
      // （フォーカス復帰/visibilitychange のたびに refreshSortingForTableId が走ると、
      //  ソート状態やフィルタUIが作り直されて選択状態が解除されるため）
      let has = false;
      try{
        if (typeof getHeaderIndexByKey === 'function'){
          has = (getHeaderIndexByKey(table, t.itemKey) !== -1);
        } else {
          const thead = table.tHead || table.querySelector('thead');
          has = !!(thead && thead.querySelector(`th.${t.itemKey}, th[data-colkey="${t.itemKey}"]`));
        }
      }catch(_){
        has = false;
      }

      // thead に ID 列があるのに tbody 側が欠けている（＝列ズレが起きる）ケースだけ補修して抜ける
      if (enabled && has){
        try{
          const idx = (typeof getHeaderIndexByKey === 'function') ? getHeaderIndexByKey(table, t.itemKey) : -1;
          const r0  = (table.tBodies && table.tBodies[0] && table.tBodies[0].rows) ? table.tBodies[0].rows[0] : null;
          const okBody = !r0 || (idx >= 0 && r0.cells && r0.cells[idx] && r0.cells[idx].classList && r0.cells[idx].classList.contains(t.itemKey));
          if (!okBody){
            ensureItemIdColumn(table, t); // thead は既にある前提で tbody を同期
          }
        }catch(_){}
        continue;
      }
      if (!enabled && !has) continue;

      if (enabled){ ensureItemIdColumn(table, t); }
      else        { removeItemIdColumn(table, t); }

      // 列構造が変わったときだけ、ソート等のヘッダー配線を再構成する
      try { refreshSortingForTableId(t.tableId); } catch(err){ console.warn('[DBE] refreshSortingForTableId failed:', err); }
    }
    // 残留オーバーレイがあれば除去（クリックブロック防止）
    document.getElementById('dbe-toast-itemidcopy')?.remove();
  }

  // 追加：ヘッダーのイベントリスナーをリセットしてから processTable を再実行
  function refreshSortingForTableId(id){
    const table = document.getElementById(id);
    if (!table) return;
    const thead = table.tHead || table.querySelector('thead');
    if (!thead || !thead.rows || !thead.rows[0]) return;
    // ヘッダー行をクローン置換（既存のクリックハンドラを除去）
    const oldRow = thead.rows[0];
    const newRow = oldRow.cloneNode(true);
    thead.replaceChild(newRow, oldRow);
    // ネックレスはフィルターUIが個別実装のため、再ワイヤ前に重複を掃除（直前の .filter-ui / .dbe-necklace-filter を全削除）
    if (id === 'necklaceTable') {
      try{
        let probe = table.previousElementSibling;
          while (probe && probe.classList && (probe.classList.contains('filter-ui') || probe.classList.contains('dbe-necklace-filter'))) {
          const prev = probe.previousElementSibling;
          probe.remove();
          probe = prev;
        }
      }catch(err){
        console.warn('[DBE] cleanup necklace filter-ui failed:', err);
      }
    }
    // 直近のソート状態をクリアしてから再ワイヤ
    try { dbeClearSortHistory(id); } catch {}
    try { processTable(id); } catch(e){ console.warn('[DBE] processTable rebind failed:', e); }
  }

  function getHeaderIndexByClass(table, klass){
    const thead = table.tHead || table.querySelector('thead');
    if (!thead) return -1;
    const ths = thead.rows[0]?.cells || [];
    for (let i=0;i<ths.length;i++){
      const th = ths[i];
      if (th.classList?.contains(klass)) return i;
      if (th.dataset?.colkey === klass)  return i;
      if (th.getAttribute?.('data-colkey') === klass) return i;
    }
    return -1;
  }

  function getHeaderIndexByKey(table, key){
    const thead = table.tHead || table.querySelector('thead');
    if (!thead) return -1;
    const ths = thead.rows[0]?.cells || [];
    for (let i=0;i<ths.length;i++){
      const th = ths[i];
      if (th.dataset?.colkey === key) return i;
      if (th.classList?.contains(key)) return i;
      if (th.getAttribute?.('data-colkey') === key) return i;
    }
    return -1;
  }

  function createTh(key, text){
    const th = document.createElement('th');
    th.dataset.colkey = key;
    th.classList.add(key);
    th.textContent = text;
    th.style.whiteSpace = 'nowrap';
    return th;
  }

  function extractItemIdFromEqupCell(cell){
    if (!cell) return null;
  // 代表的なパターンを網羅（/equip/123, /lock/123, /recycle/123, ?equip=123 等）
  const hrefs = Array.from(cell.querySelectorAll('a')).map(a => a.getAttribute('href') || '');
    for (const href of hrefs){
      const m = href.match(/(?:\/(?:equip|lock|recycle)\/|[?&](?:equip|equipid)=)(\d+)/);
      if (m) return m[1];
    }
    // 最終手段：セルのテキストから数字を拾う（桁数制限なし）
    const txt = cell.textContent || '';
    const m2 = txt.match(/(\d+)/);
    return m2 ? m2[1] : null;
  }

  // ============================================================
  // ▽ここから▽ Soft Reload Utilities（テーブル単位の再読込）
  //  - /bag を fetch して対象 table の tbody だけを差し替える
  //  - 既存のフィルタ/ソート状態は保持（UIは作り直さない）
  // ============================================================
  async function dbeFetchBagHtmlDocument(){
    const url = location.href;
    const res = await fetch(url, { credentials:'include', cache:'no-store' });
    if (!res || !res.ok) throw new Error(`fetch failed: ${res ? res.status : 'no response'}`);
    const html = await res.text();
    return new DOMParser().parseFromString(html, 'text/html');
  }

  async function dbeSoftReloadTableTbody(tableId){
    const table = document.getElementById(tableId);
    if (!table || !table.tBodies || !table.tBodies[0]) return false;
    const doc = await dbeFetchBagHtmlDocument();
    const newTable = doc.getElementById(tableId);
    if (!newTable || !newTable.tBodies || !newTable.tBodies[0]) return false;
    table.tBodies[0].innerHTML = newTable.tBodies[0].innerHTML;
    return true;
  }

  function dbeReapplyBodyColumnClasses(tableId){
    const table = document.getElementById(tableId);
    if (!table || !table.tHead || !table.tBodies || !table.tBodies[0]) return;

    const colMap = columnIds[tableId];
    if (!colMap) return;

    const knownClasses = Object.values(colMap);
    const headerCells = Array.from(table.tHead.rows[0]?.cells || []);
    if (!headerCells.length) return;

    const headerKeys = headerCells.map(th=>{
      // 1) data-colkey を優先
      const dk = th?.dataset?.colkey || '';
      if (dk) return dk;

      // 2) 既存クラスから判定
      const byCls = knownClasses.find(cls => th.classList && th.classList.contains(cls));
      if (byCls) return byCls;

      // 3) ヘッダータイトル文字列から判定
      const txt = (th.textContent || '').trim();
      return colMap[txt] || '';
    });

    Array.from(table.tBodies[0].rows).forEach(row=>{
      Array.from(row.cells || []).forEach((td, i)=>{
        if (!td) return;
        const key = headerKeys[i] || '';
        if (!key) return;

        // 列クラスの再付与
        td.classList.add(key);
      });
    });
  }

  // ============================================================
  // Settings 優先のテーブル構造再同期
  //  - フィルターUI内「再読込」時は、tbody の取得内容ではなく、
  //    #dbe-W-Settings の保存値を優先して列構造・表示状態を再構成する。
  //  - フィルター状態／ソート履歴／スクロール位置などは、従来どおり
  //    再読込直前の状態を維持する。
  // ============================================================
  function dbeRemoveTableColumnByKey(table, key, fallbackHeaderText){
    try{
      if (!table || !key) return;
      const thead = table.tHead || table.querySelector('thead');
      const tbody = table.tBodies?.[0] || table.querySelector('tbody');
      const headRow = thead && thead.rows && thead.rows[0] ? thead.rows[0] : null;
      if (!headRow) return;

      const headerCellCountBeforeRemove = headRow.cells.length;

      const indexes = [];
      Array.from(headRow.cells || []).forEach((th, i)=>{
        const byKey =
          (th.dataset && th.dataset.colkey === key) ||
          (th.classList && th.classList.contains(key)) ||
          (th.getAttribute && th.getAttribute('data-colkey') === key);
        const byText = fallbackHeaderText
          ? ((th.textContent || '').trim() === fallbackHeaderText)
          : false;
        if (byKey || byText) indexes.push(i);
      });
      if (!indexes.length) return;

      indexes.sort((a,b)=>b-a).forEach(idx=>{
        try{
          if (headRow.cells[idx]) headRow.deleteCell(idx);
        }catch(_){}
        if (tbody){
          Array.from(tbody.rows || []).forEach(row=>{
            try{
              const td = row.cells[idx];
              if (!td) return;

              const byKey =
                (td.dataset && td.dataset.colkey === key) ||
                (td.classList && td.classList.contains(key)) ||
                (td.getAttribute && td.getAttribute('data-colkey') === key);

              // 再読込直後は、thead だけが「増減」列あり・tbody は公式HTML由来の「増減」列なし、
              // という一時的な列数不一致が起きる。この状態で idx 削除すると、本来の MOD / マリモ列を
              // 誤って削除してしまうため、tbody側の列数がthead削除前と一致している場合のみ位置削除する。
              const rowLooksAlignedWithHeader = (row.cells.length === headerCellCountBeforeRemove);

              if (byKey || rowLooksAlignedWithHeader){
                row.deleteCell(idx);
              }
            }catch(_){}
          });
        }
      });
    }catch(err){
      console.warn('[DBE] dbeRemoveTableColumnByKey failed:', err);
    }
  }

  function dbeEnsureNecklaceDeltaColumnFromSettings(table){
    try{
      if (!table || table.id !== 'necklaceTable') return;
      const deltaKey = columnIds?.necklaceTable?.['増減'] || 'necClm-Dlta';

      // Settings 側が OFF の場合は、非表示ではなく列構造から外す。
      dbeRemoveTableColumnByKey(table, deltaKey, '増減');

      const showDelta = (typeof readBool === 'function') ? readBool('showDelta') : false;
      if (!showDelta) return;

      const thead = table.tHead || table.querySelector('thead');
      const tbody = table.tBodies?.[0] || table.querySelector('tbody');
      const headRow = thead && thead.rows && thead.rows[0] ? thead.rows[0] : null;
      if (!headRow || !tbody) return;

      const attrKey = columnIds?.necklaceTable?.['属性'] || 'necClm-StEf';
      let attrIdx = Array.from(headRow.cells || []).findIndex(th=>{
        return (th.dataset && th.dataset.colkey === attrKey) ||
          (th.classList && th.classList.contains(attrKey)) ||
          ((th.textContent || '').trim() === '属性');
      });
      if (attrIdx < 0) attrIdx = Math.max(0, headRow.cells.length - 1);
      const insertAt = Math.max(0, Math.min(headRow.cells.length, attrIdx + 1));

      const th = createTh(deltaKey, '増減');
      Object.assign(th.style, {
        backgroundColor:'#F0F0F0',
        color:'#000',
        textAlign:'center',
        cursor:'pointer'
      });
      headRow.insertBefore(th, headRow.children[insertAt] || null);

      const _buff   = Array.isArray(buffKeywords)   ? buffKeywords   : [];
      const _debuff = Array.isArray(debuffKeywords) ? debuffKeywords : [];

      Array.from(tbody.rows || []).forEach(row=>{
        let total = 0;
        const attrCell = row.cells[attrIdx] || null;
        if (attrCell){
          attrCell.querySelectorAll('li').forEach(li=>{
            const value = dbeGetNecklaceAttrDeltaValue(li, _buff, _debuff);
            if (typeof value === 'number' && Number.isFinite(value)) total += value;
          });
        }

        const td = document.createElement('td');
        td.dataset.colkey = deltaKey;
        td.classList.add(deltaKey);
        td.style.textAlign = 'center';
        td.textContent = total > 0 ? ('△' + total) : (total < 0 ? ('▼' + Math.abs(total)) : '0');
        row.insertBefore(td, row.children[insertAt] || null);
      });
    }catch(err){
      console.warn('[DBE] dbeEnsureNecklaceDeltaColumnFromSettings failed:', err);
    }
  }

  function dbeApplySettingsDrivenTableStructure(tableId){
    const table = document.getElementById(tableId);
    if (!table || !table.tHead || !table.tBodies || !table.tBodies[0]) return;

    // 列構造が変わる可能性があるため、ロック列インデックスキャッシュは破棄する。
    try{ delete table.dataset.lockColIdx; }catch(_){ table.dataset.lockColIdx = ''; }

    // 「名称列と装備列の間にアイテムIDを表示する」は、Settings の保存値を優先する。
    // ※公式HTMLの tbody には ID 列も増減列も存在しないため、再読込直後は
    //   thead と tbody の列構造が一時的にズレる。
    //   増減列は「属性」列直後へ挿入するため、先に ID 列を同期してから
    //   増減列を再構成しないと、増減列に MOD セルが入り込む。
    try{
      const showItemId = (typeof readBool === 'function') ? readBool('displayItemId') : false;
      const triplet =
        tableId === 'necklaceTable' ? { itemKey:'necClm-ItemID', nameKey:'necClm-Name', equpKey:'necClm-Equp' } :
        tableId === 'weaponTable'   ? { itemKey:'wepClm-ItemID', nameKey:'wepClm-Name', equpKey:'wepClm-Equp' } :
        tableId === 'armorTable'    ? { itemKey:'amrClm-ItemID', nameKey:'amrClm-Name', equpKey:'amrClm-Equp' } :
        null;
      if (triplet){
        if (showItemId) ensureItemIdColumn(table, triplet);
        else removeItemIdColumn(table, triplet);
      }
    }catch(err){
      console.warn('[DBE] apply item-id setting after soft reload failed:', err);
    }

    // ネックレス「増減」列は、ID列の同期後に、Settings の ON/OFF に合わせて再構成する。
    if (tableId === 'necklaceTable'){
      dbeEnsureNecklaceDeltaColumnFromSettings(table);
    }

    // tbody 差し替え・列追加/削除のあと、列クラスを現在の thead に合わせて再付与する。
    try{ dbeReapplyBodyColumnClasses(tableId); }catch(_){}

    // セル余白指定：Settings の保存値を優先する。
    try{
      const v = parseInt(dbeStorage.getItem(CELL_PAD_V_KEY) ?? CELL_PAD_DEFAULT_V, 10) || CELL_PAD_DEFAULT_V;
      const h = parseInt(dbeStorage.getItem(CELL_PAD_H_KEY) ?? CELL_PAD_DEFAULT_H, 10) || CELL_PAD_DEFAULT_H;
      applyCellPaddingCss(v, h);
    }catch(_){}

    // 名称セル2行目（装備種＋クラス）の表示/非表示
    try{
      const hide = (typeof readBool === 'function') ? readBool('hideKindClass') : false;
      if (typeof toggleNameSubLine === 'function') toggleNameSubLine(hide, tableId);
    }catch(_){}

    // ［錠］/［解錠］背景色
    try{ applyCellColors(); }catch(_){}
    if (tableId === 'necklaceTable'){
      try{ dbeApplyNecklaceDebuffColoring(table); }catch(_){}
    }

    // 「錠／解錠」列の表示/非表示
    try{
      const hideLock = (typeof readBool === 'function') ? readBool('hideLockCol') : false;
      if (typeof toggleLockColumn === 'function') toggleLockColumn(hideLock, tableId);
    }catch(_){}

    // 「分解」列の表示/非表示
    try{
      const hideRycl = (typeof readBool === 'function') ? readBool('hideRyclCol') : false;
      const cls = columnIds?.[tableId]?.['分解'];
      if (cls){
        table.querySelectorAll(`.${cls}`).forEach(el=>{
          el.style.display = hideRycl ? 'none' : '';
        });
      }
    }catch(_){}
  }

  // ============================================================
  // ▽ここから▽ ItemID Copy Utilities（v13.11.4 用・互換実装）
  //  - /equip/<数字> 等から固有IDを抽出
  //  - ボタンのテキストにIDを表示
  //  - クリックでIDをコピー（clipboard / fallback）
  //  - dbeExtractItemIdFromRow の引数順（(tr,kind) と (kind,tr)）両対応
  // ============================================================

  /** 抽出: (tr, kind) と (kind, tr) の両方を受け付ける */
  function dbeExtractItemIdFromRow(a, b){
    try{
      let tr, kind;
      if (a instanceof HTMLTableRowElement){
        tr = a; kind = b;
      }else{
        kind = a; tr = b;
      }
      if (!tr) return null;
      const equipCls =
        (kind === 'nec') ? 'necClm-Equp' :
        (kind === 'wep') ? 'wepClm-Equp' :
        (kind === 'amr') ? 'amrClm-Equp' : null;
      let cell = null;
      if (equipCls){
        cell = tr.querySelector(`td.${equipCls}`);
      }
      // 念のためフォールバック（多くのテーブルで2列目が「装」想定）
      if (!cell && tr.cells && tr.cells.length >= 2){
        cell = tr.cells[1];
      }
      if (!cell) return null;
      const aTag = cell.querySelector('a[href]');
      if (!aTag || !aTag.href) return null;
      const href = aTag.href;
      // .../equip/12345, .../item/12345, ?id=12345, ?item=12345 などを許容
      const m =
        href.match(/(?:equip|item|id)[=/](\d+)/i) ||
        href.match(/[?&](?:id|item)=(\d+)/i);
      return m ? m[1] : null;
    }catch(_){
      return null;
    }
  }

  /** 文字列をクリップボードへ（失敗時は fallback） */
  async function dbeCopyTextToClipboard(text){
    try{
      if (navigator.clipboard && navigator.clipboard.writeText){
        await navigator.clipboard.writeText(text);
        return true;
      }
    }catch(_){}
    try{
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return !!ok;
    }catch(_){
      return false;
    }
  }

  /** 視覚フィードバック用の簡易トースト（任意） */
  function dbeShowItemIdToast(message){
    let toast = document.getElementById('dbe-toast-itemidcopy');
    if (!toast){
      toast = document.createElement('div');
      toast.id = 'dbe-toast-itemidcopy';
      Object.assign(toast.style, {
        position:'fixed', inset:'0', display:'flex',
        alignItems:'center', justifyContent:'center',
        background:'rgba(0,0,0,0.25)', zIndex: 2147483647,
      });
      const box = document.createElement('div');
      Object.assign(box.style, {
        background:'#fff', color:'#000', padding:'12px 16px',
        borderRadius:'10px', boxShadow:'0 4px 12px rgba(0,0,0,0.2)',
        maxWidth:'90%', textAlign:'center', fontSize:'1em'
      });
      box.id = 'dbe-toast-itemidcopy-box';
      toast.appendChild(box);
      document.body.appendChild(toast);
      toast.addEventListener('click', ()=> toast.remove());
    }
    const box = toast.querySelector('#dbe-toast-itemidcopy-box');
    if (box) box.textContent = message;
    toast.style.display = 'flex';
    clearTimeout(dbeShowItemIdToast._tid);
    dbeShowItemIdToast._tid = setTimeout(()=>{ toast.remove(); }, 1200);
  }

  /** ItemID コピー用ボタン（生成時にIDをラベル表示、クリックでコピー） */
  function dbeMakeItemIdCopyBtn(tr, kind){
    const id = dbeExtractItemIdFromRow(tr, kind);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dbe-btn-copyid';
    btn.textContent = id ?? '-';
    btn.title = id ? 'クリックでIDをコピー' : 'IDが見つかりません';
    btn.disabled = !id;
    btn.addEventListener('click', async (ev)=>{
      try{ ev.preventDefault(); ev.stopPropagation(); }catch(_){}
      if (!id) return;
      const ok = await dbeCopyTextToClipboard(id);
      if (ok){
        const old = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(()=>{ btn.textContent = old; }, 1200);
        dbeShowItemIdToast('クリップボードに 装備ID:' + id + ' をコピーしました。');
      }else{
        dbeShowItemIdToast('IDコピーに失敗しました');
      }
    }, {passive:false});
    return btn;
  }

  /** 既存呼び出し互換：makeCopyBtn(tr, kind) を公開 */
  function makeCopyBtn(tr, kind){
    return dbeMakeItemIdCopyBtn(tr, kind);
  }

  /** 最低限の見た目（必要なら削ってOK） */
  (function ensureCopyBtnStyle(){
    try{
      if (document.getElementById('dbe-style-copyid')) return;
      const st = document.createElement('style');
      st.id = 'dbe-style-copyid';
      st.textContent = `
        .dbe-btn-copyid{
          margin:auto;
          padding: 0.2em 0.6em;
          font-size: 0.9em;
          line-height: 1.1em;
          cursor: pointer;
        }
        .dbe-btn-copyid[disabled]{ opacity: .5; cursor: not-allowed; }
      `;
      document.head.appendChild(st);
    }catch(_){}
  })();
  // ============================================================
  // △ここまで△ ItemID Copy Utilities
  // ============================================================

  function ensureItemIdColumn(table, {itemKey, nameKey, equpKey}){
    const thead = table.tHead || table.querySelector('thead');
    const tbody = table.tBodies?.[0] || table.querySelector('tbody');
    if (!thead || !tbody) return;
    const trh = thead.rows[0];
    if (!trh) return;

    // thead に既に ID 列がある場合は、その位置に tbody を同期する（再読込直後の列ズレ対策）
    let insertAt = -1;
    try{
      insertAt = getHeaderIndexByKey(table, itemKey);
    }catch(_){
      insertAt = -1;
    }

    if (insertAt === -1){
      const nameIdx = getHeaderIndexByClass(table, nameKey);
      const equpIdx = getHeaderIndexByClass(table, equpKey);
      if (nameIdx < 0 || equpIdx < 0) return;

      insertAt = nameIdx + 1; // 名称直後（＝名称と装備の間）

      // ヘッダに TH を挿入
      const th = createTh(itemKey, 'ID');
      // ← 追加：他ヘッダーの色をコピーして、中央寄せにする
      try {
        // 自分以外の既存ヘッダー（なければ先頭TH）を参照
        const ref = trh.querySelector(`th:not([data-colkey="${itemKey}"])`) || trh.querySelector('th');
          if (ref) {
          const cs = getComputedStyle(ref);
          th.style.backgroundColor = cs.backgroundColor;
          th.style.color = cs.color;
          // もし他ヘッダーが左右や上下の余白/枠線を指定していれば、必要に応じて下記を有効化
          // th.style.border = cs.border;
          // th.style.padding = cs.padding;
        }
        th.style.textAlign = 'center';
      } catch { th.style.textAlign = 'center'; }
      trh.insertBefore(th, trh.children[insertAt] || null);
    }

    // テーブルIDから kind を判定（ネックレス／武器／防具）
    const kind =
      (table.id === 'necklaceTable') ? 'nec' :
      (table.id === 'weaponTable')   ? 'wep' :
      (table.id === 'armorTable')    ? 'amr' : null;

    // ボディに TD を挿入。実IDの抽出はクリック時（makeCopyBtn）に行う。
    for (const tr of Array.from(tbody.rows)){
      // すでに正しい位置に存在するなら何もしない
      try{
        if (insertAt >= 0 && tr.children[insertAt] && tr.children[insertAt].classList && tr.children[insertAt].classList.contains(itemKey)) continue;
      }catch(_){}

      // 位置ズレも含め、既存の ID セルがあれば一旦除去
      try{
        tr.querySelectorAll(`td.${itemKey}, td[data-colkey="${itemKey}"]`).forEach(el=>el.remove());
      }catch(_){}
      const td = document.createElement('td');
      td.dataset.colkey = itemKey;
      td.classList.add(itemKey);
      td.style.textAlign = 'center';
      td.appendChild(makeCopyBtn(tr, kind));
      tr.insertBefore(td, tr.children[insertAt] || null);
    }
  }

  function removeItemIdColumn(table, {itemKey}){
    const thead = table.tHead || table.querySelector('thead');
    const tbody = table.tBodies?.[0] || table.querySelector('tbody');
    if (!thead || !tbody) return;
    const idx = getHeaderIndexByKey(table, itemKey);
    if (idx === -1) return;
    const trh = thead.rows[0];

const headerCellCountBeforeRemove = trh && trh.cells ? trh.cells.length : -1;

    if (trh && trh.children[idx]) trh.removeChild(trh.children[idx]);
    for (const tr of Array.from(tbody.rows)){
      try{
        const td = tr.children[idx];
        if (!td) continue;

        const byKey =
          (td.dataset && td.dataset.colkey === itemKey) ||
          (td.classList && td.classList.contains(itemKey)) ||
          (td.getAttribute && td.getAttribute('data-colkey') === itemKey);

        // 再読込直後は、thead 側にだけ ID 列が残り、tbody 側は公式HTML由来で
        // ID 列なしのことがある。この状態で idx 位置を無条件削除すると、
        // 本来の「装」セルを削除して列ズレを起こすため、tbody 側が
        // thead 削除前の列数と一致している場合、または ID セル自身と判定できる場合だけ削除する。
        const rowLooksAlignedWithHeader = (headerCellCountBeforeRemove > 0 && tr.children.length === headerCellCountBeforeRemove);

        if (byKey || rowLooksAlignedWithHeader){
          tr.removeChild(td);
        }
      }catch(_){}
    }
  }
  // 〓〓〓 追加：アイテムID列の ON/OFF ▲ここまで▲ 〓〓〓

  // ▼ここから▼======================================================================
  // 〓〓〓 テーブルセルの padding を適用する（necklace/weapon/armor 全体） 〓〓〓
  function applyCellPaddingCss(vPx, hPx){
    const v = Number.isFinite(+vPx) ? Math.max(0, (+vPx|0)) : CELL_PAD_DEFAULT_V;
    const h = Number.isFinite(+hPx) ? Math.max(0, (+hPx|0)) : CELL_PAD_DEFAULT_H;
    let style = document.getElementById('dbe-cellpad-style');
    if (!style){
      style = document.createElement('style');
      style.id = 'dbe-cellpad-style';
      document.head.appendChild(style);
    }
    style.textContent =
      `#necklaceTable td, #weaponTable td, #armorTable td { padding: ${v}px ${h}px !important; }`;
  }

  // 〓〓〓 dbe-Menu-settings（dbe-W-Settings）に「セルの余白指定」行を移植 〓〓〓
  function buildCellPaddingControlsInSettings(){
    const wnd = document.getElementById('dbe-W-Settings');
    const panel = wnd ? (wnd.querySelector('#dbe-panel0-Settings') || wnd) : null;
    if (!panel) return false;

    // すでに作成済みなら何もしない
    if (panel.querySelector('#dbe-cellpad-row')) return true;

    // 挿入位置：「装備テーブルのカスタマイズ」枠内の先頭
    // ※枠がまだ無いタイミングでは、従来どおり「基準文字サイズ」の直下へフォールバック
    const customBox = panel.querySelector('#dbe-prm-panel0-equipment-table-custom-box');
    const anchorLeaf = customBox ? null : Array.from(panel.querySelectorAll('*'))
      .find(el => el.childElementCount === 0 && typeof el.textContent === 'string' && el.textContent.includes('基準文字サイズ'));
    const anchor = (!customBox && anchorLeaf) ? (anchorLeaf.closest('div,li,section,p') || anchorLeaf) : null;

    // 行本体
    const row = document.createElement('div');
    row.id = 'dbe-cellpad-row';
    row.style.cssText = 'display:flex;align-items:center;gap:10px;margin:6px 0;flex-wrap:nowrap;white-space:nowrap;color:#000;';

    const title = document.createElement('span');
    title.id = 'dbe-cellpad-title';
    title.textContent = 'セルの余白指定：';
    Object.assign(title.style, {
      display:'inline-block',
      minWidth:'8em',
      whiteSpace:'nowrap',
      fontSize:'1em',
      fontWeight:'normal',
      color:'#000',
      flex:'0 0 auto'
    });
    row.appendChild(title);

    const makeBox = (title, key, defVal) => {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'display:flex;align-items:center;gap:4px;flex-wrap:nowrap;white-space:nowrap;';
      const t = document.createElement('span'); t.textContent = title;
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.step = '1';
      input.style.cssText = 'width:2.5em;padding:2px 4px;font-size:0.9em;flex:0 0 auto;'; // 縮まない
      input.value = dbeStorage.getItem(key) ?? String(defVal);
      const px = document.createElement('span'); px.textContent = 'px';
      wrap.appendChild(t); wrap.appendChild(input); wrap.appendChild(px);
      input.addEventListener('change', ()=>{
        const num = Math.max(0, (parseInt(input.value,10) || 0));
        dbeStorage.setItem(key, String(num));
        const vNow = parseInt(dbeStorage.getItem(CELL_PAD_V_KEY) ?? CELL_PAD_DEFAULT_V, 10) || CELL_PAD_DEFAULT_V;
        const hNow = parseInt(dbeStorage.getItem(CELL_PAD_H_KEY) ?? CELL_PAD_DEFAULT_H, 10) || CELL_PAD_DEFAULT_H;
        applyCellPaddingCss(vNow, hNow);
      });
      return {wrap, input};
    };

    const vCtl = makeBox('上下', CELL_PAD_V_KEY, CELL_PAD_DEFAULT_V);
    const hCtl = makeBox('左右', CELL_PAD_H_KEY, CELL_PAD_DEFAULT_H);
    row.appendChild(vCtl.wrap);
    row.appendChild(hCtl.wrap);

    // 挿入（装備テーブルカスタマイズ枠があれば先頭。それが無ければアンカー直下→末尾）
    if (customBox){
      customBox.insertBefore(row, customBox.firstChild);
    } else if (anchor && anchor.parentNode){
      anchor.parentNode.insertBefore(row, anchor.nextSibling);
    } else {
      panel.appendChild(row);
    }
    // 既存の保存値で CSS を適用しておく
    const v = parseInt(dbeStorage.getItem(CELL_PAD_V_KEY) ?? CELL_PAD_DEFAULT_V, 10) || CELL_PAD_DEFAULT_V;
    const h = parseInt(dbeStorage.getItem(CELL_PAD_H_KEY) ?? CELL_PAD_DEFAULT_H, 10) || CELL_PAD_DEFAULT_H;
    applyCellPaddingCss(v, h);
    return true;
  }

  // 〓〓〓 初期化（パネル生成時期に依存しない） 〓〓〓
  function initCellPaddingControls(){
    if (buildCellPaddingControlsInSettings()) return;
    const obs = new MutationObserver(()=>{
      if (buildCellPaddingControlsInSettings()){
        obs.disconnect();
      }
    });
    obs.observe(document.documentElement, {childList:true, subtree:true});
  }

  // 即時起動
  initCellPaddingControls();
  // ▲ここまで▲======================================================================

  // 〓〓〓 メニューUIを保存値から再同期 〓〓〓
  function syncMenuFromStorage(){
    // 新仕様：W-Settings を同期対象にする（旧パネルは廃止）
    const menu = document.getElementById('dbe-W-Settings');
    if (!menu) return;

    // 基準文字サイズ
    applyBaseFontSize();
    const fs = readStr('baseFontSize');
    menu.querySelectorAll('input[name="dbe-fontsize"]').forEach(r=>{
      r.checked = (r.value === fs);
    });

    // 色
    const uc = readStr('unlockedColor'), lc = readStr('lockedColor');
    const uColor = menu.querySelector('#dbe-prm-panel0-setcolor-cell-unlocked');
    const uText  = menu.querySelector('#dbe-prm-panel0-text-unlocked');
    const lColor = menu.querySelector('#dbe-prm-panel0-setcolor-cell-locked');
    const lText  = menu.querySelector('#dbe-prm-panel0-text-locked');
    if (uColor) uColor.value = uc; if (uText) uText.value = uc;
    if (lColor) lColor.value = lc; if (lText) lText.value = lc;
    applyCellColors();

    // ネックレス属性の簡易表示
    const simpleNecAttr = readBool('showSimpleNecAttr');
    const simpleNecAttrCk = menu.querySelector('#dbe-prm-panel0-check-simple-nec-attr');
    if (simpleNecAttrCk) simpleNecAttrCk.checked = simpleNecAttr;
    dbeApplyAllNecklaceAttrDisplay();

    // ネックレス増減列
    const showDelta = readBool('showDelta');
    const deltaCk = menu.querySelector('#dbe-prm-panel0-check-display-necClm-Dlta');
    if (deltaCk) deltaCk.checked = showDelta;
    toggleDeltaColumn(showDelta);

    // 分解列の非表示
    const hideRycl = readBool('hideRyclCol');
    const ryclCk = menu.querySelector('#dbe-prm-panel0-check-hide-Clm-Rycl');
    if (ryclCk) ryclCk.checked = hideRycl;
    tableIds.forEach(id=>{
      document.querySelectorAll(`.${columnIds[id]['分解']}`)
        .forEach(el=> el.style.display = hideRycl ? 'none' : '');
    });

    // 「全て分解する」ボタンの非表示（移植先：Recycle ウィンドウ）
    const hideAll = readBool('hideAllBtn');
    const rWnd = document.getElementById('dbe-W-Recycle');
    const allCk = rWnd ? rWnd.querySelector('#dbe-prm-recycle-check-hide-RyclUnLck, #dbe-prm-panel0-check-hide-RyclUnLck') : null;
    if (allCk) allCk.checked = hideAll;
    document.querySelectorAll('button, a').forEach(el=>{
      if (el.textContent==='ロックされていないアイテムを全て分解する' && !(rWnd && rWnd.contains(el))) {
        el.style.display = hideAll ? 'none' : '';
      }
    });

    // アイテムID列の表示
    const showItemId = readBool('displayItemId');
    const itemIdCk = menu.querySelector('#dbe-prm-panel0-check-display-ItemID');
    if (itemIdCk) itemIdCk.checked = showItemId;
    toggleItemIdColumn(showItemId);

    // DBEランチャーボタン（携帯端末用）の配置
    const mobileLauncherPos = dbeNormalizeMobileLauncherPosition(readStr('mobileLauncherPos'));
    menu.querySelectorAll('input[name="dbe-mobile-launcher-pos"]').forEach(r=>{
      r.checked = (r.value === mobileLauncherPos);
    });
    dbeApplyMobileLauncherPosition(null, mobileLauncherPos);

    // まきこみアラート（チェック状態を保存値に合わせ直す）
    menu.querySelectorAll('input[id^="alert-grade-"], input[id^="alert-rarity-"]').forEach(el=>{
      el.checked = dbeStorage.getItem(el.id) === 'true';
    });
  }

  // --- 基準文字サイズ適用 ---
  function applyBaseFontSize(){
    const size = readStr('baseFontSize');
    document.documentElement.style.fontSize = size;
  }

  // --- 確認ダイアログを出す ---
  function showConfirm(message){
    return new Promise(resolve => {
      const existing = document.getElementById('donguriConfirmOverlay');
      if (existing) existing.remove();
      const ov = document.createElement('div');
      ov.id = 'donguriConfirmOverlay';
      Object.assign(ov.style, {
        position:'fixed',top:0,left:0,width:'100%',height:'100%',
        backgroundColor:'rgba(0,0,0,0.5)',
        display:'flex',justifyContent:'center',alignItems:'center',zIndex:1001001
      });
      const box = document.createElement('div');
      Object.assign(box.style, {
        backgroundColor:'#fff',padding:'20px',borderRadius:'8px',
        border:'5px solid #FF6600',textAlign:'center',color:'#000',
        maxWidth:'80%',fontSize:'1.1em'
      });
      // 第一段落を引数で受け取る
      const p1 = document.createElement('p');
      p1.textContent = message;
      const p2 = document.createElement('p');
      p2.textContent = 'このまま分解を行いますか？';
      box.append(p1,p2);
      const btns = document.createElement('div'); btns.style.marginTop='16px';
      const ok = document.createElement('button');   ok.textContent='分解する'; ok.style.margin='10px';
      const no = document.createElement('button');   no.textContent='キャンセル'; no.style.margin='10px';
      btns.append(ok,no);
      box.appendChild(btns);
      ov.appendChild(box);
      document.body.appendChild(ov);
      ok.addEventListener('click', ()=>{ ov.remove(); resolve(true); });
      no.addEventListener('click', ()=>{ ov.remove(); resolve(false); });
    });
  }

  // --- 一括分解送信の保留＆確認機能 ---
  function initBulkRecycle(){
    const forms = document.querySelectorAll('form[action$="/recycleunlocked"][method="POST"]');
    forms.forEach(form=>{
      form.addEventListener('submit', async e=>{
        e.preventDefault();
        showOverlay('まとめて分解します…');
        // ユーザーがチェックしたグレード／レアリティを収集
        const selectedGrades    = Array.from(document.querySelectorAll('input[id^="alert-grade-"]:checked')).map(i=>i.value);
        const selectedRarities  = Array.from(document.querySelectorAll('input[id^="alert-rarity-"]:checked')).map(i=>i.value);
              const foundTypes = new Set();

         // テーブルを順に調べて
        for (const id of tableIds){
          const table = document.getElementById(id);
          if (!table?.tHead) continue;
          const hdrs = table.tHead.rows[0].cells;
          let lockIdx=-1,nameIdx=-1;
          for (let i=0;i<hdrs.length;i++){
            const t = hdrs[i].textContent.trim();
            if (t==='解')      lockIdx = i;
            if (t==='ネックレス' && id==='necklaceTable') nameIdx = i;
            if (t==='武器'     && id==='weaponTable')     nameIdx = i;
            if (t==='防具'     && id==='armorTable')      nameIdx = i;
          }
          if (lockIdx<0||nameIdx<0) continue;

          Array.from(table.tBodies[0].rows).forEach(row=>{
            // アンロック済みだけ対象
            if (!row.cells[lockIdx].querySelector('a[href*="/lock/"]')) return;
            const text = row.cells[nameIdx].textContent;
            // レアリティ
            selectedRarities.forEach(rk => {
              if (text.includes(rk)) foundTypes.add(rk);
            });
            // グレード
            selectedGrades.forEach(gd => {
              if (text.includes(gd)) foundTypes.add(gd);
            });
          });
        }

        // １つでもヒットしたら警告（ヒットしたグレードは日本語に置換）
        if (foundTypes.size > 0){
          const labels = Array.from(foundTypes)
            .map(type => gradeNames[type] || type)
            .join(', ');
          const ok = await showConfirm(`分解するアイテムに ${labels} が含まれています。`);
        if (!ok){
            hideOverlay();
            return;
        }
      }

      // 実行
      try {
        await fetch(form.action,{method:'POST'});
          location.reload();
        } catch{ hideOverlay(); }
      });
    });
  }

  // --- ロック/アンロック切替機能 ---
  function initLockToggle(){
    tableIds.forEach(id=>{
      const table = document.getElementById(id);
      if (!table || !table.tHead) return;
      // ★二重配線防止（patchBagFromDoc 後に再実行されるため）
      try{
        if (table.dataset && table.dataset.dbeLockToggleInit === '1') return;
        if (table.dataset) table.dataset.dbeLockToggleInit = '1';
      }catch(_){}

      const colMap = columnIds[id];
      const hdrs   = Array.from(table.tHead.rows[0].cells);
      let lockIdx=-1,ryclIdx=-1,equpIdx=-1;
      hdrs.forEach((th,i)=>{
        const t = th.textContent.trim();
        if (!colMap[t]) return;
        th.classList.add(colMap[t]);
        if (t==='解') lockIdx=i;
        if (t==='分解') ryclIdx=i;
        if (t==='装') equpIdx=i;
      });
      Array.from(table.tBodies[0].rows).forEach(row => {
        if (lockIdx >= 0) {
          const cell = row.cells[lockIdx];
          cell.classList.add(colMap['解']);
          const state = dbeGetLockCellState(cell);
          dbeApplyLockCellStateAttr(cell, state);
        }
        if (ryclIdx >= 0) {
          row.cells[ryclIdx].classList.add(colMap['分解']);
        }
      });
      // 初期色付け
      applyCellColors();

      // 公式改修後の toggleLock(this, type, id) は、クリック後に同一セルの文字だけを
      // [錠] / [解錠] へ差し替えるため、DBE側の背景色も後追いで再適用する。
      table.addEventListener('click', e=>{
        try{
          const a = e.target.closest('a');
          if (!a) return;
          const td = a.closest('td');
          if (!td) return;
          const tr = td.closest('tr');
          const __lockIdxNow = findLockColumnIndex(table);
          const __tdIdxNow = (tr && tr.cells) ? Array.prototype.indexOf.call(tr.cells, td) : -1;
          if (__lockIdxNow < 0 || __tdIdxNow !== __lockIdxNow) return;

          const href = String(a.getAttribute('href') || a.href || '');
          const onclick = String(a.getAttribute('onclick') || '');
          const text = String(a.textContent || '').replace(/\s+/g, '');
          const looksLockToggle = href.includes('/lock/') || href.includes('/unlock/') || /toggleLock\s*\(/.test(onclick) || /^javascript:/i.test(href) || text.includes('解錠') || text.includes('錠');
          if (!looksLockToggle) return;

          const reapply = ()=>{
            try{
              // クリック後は secured/released 属性が古いまま残っている場合があるため、
              // いま見えているリンク文字列 [錠] / [解錠] を優先して状態を取り直す。
              dbeReapplyLockCellColorKeepingScroll(td, { preferDom:true });
            }catch(_){}
          };
          setTimeout(reapply, 0);
          setTimeout(reapply, 30);
          setTimeout(reapply, 80);
          setTimeout(reapply, 350);
          setTimeout(reapply, 1000);
        }catch(_){}
      });

      // イベント
      table.addEventListener('click', async e=>{
        const a = e.target.closest('a[href*="/lock/"],a[href*="/unlock/"]');
        if (!a) return;
        const td = a.closest('td');
        if (!td) return;
        const tr = td.closest('tr');
        if (!tr) return;
        // 「名称列クリックで行を限定」等で class が失われた行でも動くように、
        // 見出しテキストから現在の列indexを動的取得して「解」列クリックだけを捕捉する
        const __getHdrIdx = (label)=>{
          try{
            const head = table.tHead && table.tHead.rows && table.tHead.rows[0];
            if (!head) return -1;
            const cells = head.cells || [];
            for (let i=0;i<cells.length;i++){
              if (((cells[i].textContent||'').trim()) === label) return i;
            }
          }catch(_){}
          return -1;
        };
        const __lockIdxNow = __getHdrIdx('解');
        const __tdIdxNow   = (tr && tr.cells) ? Array.prototype.indexOf.call(tr.cells, td) : -1;
        if (__lockIdxNow >= 0 && __tdIdxNow >= 0 && __tdIdxNow !== __lockIdxNow) return;
        e.preventDefault();
        // クリック位置を記憶（後でスクロール復帰）
        try{ recordClickedCell(td, table); }catch(_){}
        const isUnlock = a.href.includes('/unlock/');
        showOverlay(isUnlock ? 'アンロックしています...' : 'ロックしています...');
        let itemId = null;
        try {
          // 1) 行の《装》セルから itemId を抽出（リンク書式に依存しない）
          try{
            const __equpIdxNow = __getHdrIdx('装');
            const equpCell = (tr && __equpIdxNow>=0) ? tr.cells[__equpIdxNow] : ((tr && equpIdx>=0) ? tr.cells[equpIdx] : null);
            if (typeof extractItemIdFromEqupCell === 'function'){
              itemId = extractItemIdFromEqupCell(equpCell);
            }
            if (!itemId && equpCell){
              const m = (equpCell.textContent||'').match(/(\d+)/);
              itemId = m ? m[1] : null;
            }
            // フォールバック：行内の /equip/<id> から抽出（列位置/class に依存しない）
            if (!itemId && tr){
              const eqA = tr.querySelector('a[href*="/equip/"]');
              const href = eqA ? (eqA.getAttribute('href') || eqA.href || '') : '';
              const mm = href.match(/\/equip\/(\d+)/);
              itemId = mm ? mm[1] : null;
            }
          }catch(_){}

          // 2) 送信は form の有無で POST/GET を自動判定
          const form = a.closest('form');
          let html = '';
          const fetchOptBase = { credentials:'include', redirect:'follow' };
          if (form){
            const method = (form.method||'POST').toUpperCase();
            const action = form.action || a.href;
            const fd = new FormData(form);
            const res = await fetch(action, Object.assign({}, fetchOptBase, { method, body: method==='POST' ? fd : undefined }));
            html = await res.text();
            // ログ：ロック／解錠の記録（itemId が取れていれば残す）
            try{ if (itemId) dbeChestLogActionById(itemId, isUnlock ? '解錠' : 'ロック'); }catch(_){}
          } else {
            const res = await fetch(a.href, Object.assign({}, fetchOptBase, { method:'GET' }));
            html = await res.text();
            // a.href に ID が含まれる形式ならログ化
            try{
              const mm = a.href.match(/\/(unlock|lock)\/(\d+)/);
              if (mm) dbeChestLogActionById(mm[2], mm[1]==='lock'?'ロック':'解錠');
            }catch(_){}
          }

          // 3) 返ってきた内容からテーブルを取り出す。
          //    2026-06 時点で /lock/{id} がプレーンテキスト「成功」を返すケースがあるため、
          //    応答内に /bag テーブルが無い場合は通常遷移せず、/bag を明示取得して差し替え元にする。
          let doc  = new DOMParser().parseFromString(html,'text/html');
          let newTable = doc.getElementById(id);
          if (!newTable || !newTable.tHead || !newTable.tBodies[0]) {
            const bagRes = await fetch(DBE_ORIGIN + '/bag', Object.assign({}, fetchOptBase, { method:'GET' }));
            html = await bagRes.text();
            doc  = new DOMParser().parseFromString(html,'text/html');
            newTable = doc.getElementById(id);
          }
          if (!newTable || !newTable.tHead || !newTable.tBodies[0]) {
            throw new Error('lock/unlock response did not contain target table: ' + id);
          }
          let newLockIdx=-1,newRyclIdx=-1;
          Array.from(newTable.tHead.rows[0].cells).forEach((th,i)=>{
            if ((th.textContent||'').trim()==='解')   newLockIdx=i;
            if ((th.textContent||'').trim()==='分解') newRyclIdx=i;
          });
          if (newLockIdx<0){ throw new Error('lock/unlock refreshed table has no lock column: ' + id); }
          // itemId がなければフォールバックで a.href から推測
          if (!itemId){
            const mm = a.href.match(/\/(?:unlock|lock)\/(\d+)/);
            itemId = mm ? mm[1] : null;
          }
          const targetA = Array.from(newTable.tBodies[0].rows)
                                .map(r=>r.cells[newLockIdx])
                                .find(c=> itemId
                                  ? c.querySelector(`a[href*="/${itemId}"]`)
                                  : c.querySelector('a[href*="/unlock/"],a[href*="/lock/"]'));
          if (!targetA){ throw new Error('lock/unlock target row not found: ' + (itemId || 'unknown')); }
          const targetB = targetA.closest('tr')?.cells?.[newRyclIdx] || null;
          td.innerHTML = targetA.innerHTML;
          const __ryclIdxNow = __getHdrIdx('分解');
          const ryTd = (__ryclIdxNow>=0 && tr && tr.cells) ? tr.cells[__ryclIdxNow] : (tr ? tr.querySelector(`td.${colMap['分解']}`) : null);
          if (ryTd) ryTd.innerHTML = targetB?.innerHTML || '';
          // secured/released 属性を更新（色付け/マーカーの整合性）
          try{
            dbeApplyLockCellStateAttr(td, dbeGetLockCellState(td, { preferDom:true }));
          }catch(_){}
          // 再色付け
          dbeReapplyLockCellColorKeepingScroll(td, { preferDom:true });
        } catch(_err){
          // 失敗時も /lock・/unlock への通常遷移は行わない（プレーンテキスト「成功」ページへの遷移を防ぐ）。
          console.error('[DBE] lock/unlock toggle failed:', _err);
          try{
            if (!itemId) {
              const mm = a.href.match(/\/(?:unlock|lock)\/(\d+)/);
              itemId = mm ? mm[1] : null;
            }
            dbeShowAlertDialog(
              'ロック／解錠の反映に失敗しました。\nページを再読み込みして状態を確認してください。',
              null,
              {
                reloadButton: {
                  label: 'ページの再読み込み',
                  onClick: ()=>dbeReloadPageAndRestoreItemRow(itemId)
                }
              }
            );
          }catch(_e){
            alert('ロック／解錠の反映に失敗しました。\nページを再読み込みして状態を確認してください。');
          }
          return;
        } finally {
          hideOverlay();
        }
      });
    });
  }

  // --- 装備（/equip/）クリック：リロード抑止＋OKダイアログ ---
  function initEquip(){
    tableIds.forEach(id=>{
      const table = document.getElementById(id);
      if (!table) return;

      // ★二重配線防止（patchBagFromDoc 後に再実行されるため）
      try{
        if (table.dataset && table.dataset.dbeEquipInit === '1') return;
        if (table.dataset) table.dataset.dbeEquipInit = '1';
      }catch(_){}

      table.addEventListener('click', async e=>{
        const a = e.target.closest('a[href*="/equip/"]');
        if (!a) return;
        const href = String(a.getAttribute('href') || a.href || '');
        const m = href.match(/\/equip\/(\d+)/);
        if (!m) return;

        // ここに来たら「装備」リンク扱い：通常遷移（リロード）を抑止
        e.preventDefault();
        try{ e.stopPropagation(); }catch(_){}

        const itemId = m[1];
        const tr = a.closest('tr');

        // 同一行の名称列からアイテム名（＋武器/防具のみレアリティ）を取得
        let itemName = '';
        try{
          const nameTd = getNameCell(tr);
          const baseName = pickPrimaryItemNameFromNameTd(nameTd);
          // weaponTable / armorTable のみレアリティを付与
          if (id === 'weaponTable' || id === 'armorTable'){
            const rar = pickRarityFromNameTd(nameTd);
            if (rar){
              itemName = `【${rar}】${baseName || ''}`.trim();
            } else {
              itemName = baseName || '';
            }
          } else {
            itemName = baseName || '';
          }
        }catch(_){
          itemName = '';
        }

        // 装備実行（サーバーに /equip/{id} を叩く）
        try{
          await fetch(href, { credentials:'include', redirect:'follow' });
        }catch(err){
          console.error('[DBE] equip failed:', err);
          try{
            dbeShowAlertDialog(`装備に失敗しました。\nID：${itemId}`);
          }catch(_e){
            alert(`装備に失敗しました。\nID：${itemId}`);
          }
          return;
        }

        // OKダイアログ表示
        try{
          dbeShowOkDialog('装備', `${itemName || ''}\nID：${itemId}\nを装備しました。`.trim());
        }catch(_e){
          alert(`${itemName || ''}\nID：${itemId}\nを装備しました。`.trim());
        }
      });
    });
  }

  // --- 分解機能改良 ---
  function initRecycle(){
    tableIds.forEach(id=>{
      const table = document.getElementById(id);
      if (!table) return;
      // ★二重配線防止（patchBagFromDoc 後に再実行されるため）
      try{
        if (table.dataset && table.dataset.dbeRecycleInit === '1') return;
        if (table.dataset) table.dataset.dbeRecycleInit = '1';
      }catch(_){}

      table.addEventListener('click', async e=>{
        const a = e.target.closest('a[href*="/recycle/"]');
        if (!a) return;
        e.preventDefault();
        const m = a.href.match(/\/recycle\/(\d+)/);
        if (!m) return;
        recycleTableId = id;
        recycleItemId  = m[1];
        showOverlay('分解しています...');
          try {
            // ▼ログ追加：分解の記録
            try{ dbeChestLogActionById(recycleItemId,'分解'); }catch(_){ }
          const res = await fetch(a.href);
          const html = await res.text();
          const doc  = new DOMParser().parseFromString(html,'text/html');
          const newTable = doc.getElementById(recycleTableId);
          let found = false;
          if (newTable?.tBodies[0]){
            Array.from(newTable.tBodies[0].rows).forEach(row=>{
              if (row.querySelector(`a[href*="/recycle/${recycleItemId}"]`)) found = true;
            });
          }
          if (found){
            hideOverlay();
            location.reload();
          } else {
            const curr = document.getElementById(recycleTableId);
            if (curr?.tBodies[0]){
              Array.from(curr.tBodies[0].rows).forEach(row=>{
                if (row.querySelector(`a[href*="/recycle/${recycleItemId}"]`)) row.remove();
              });
            }
            hideOverlay();
          }
        } catch{ hideOverlay(); }
        recycleTableId = null;
        recycleItemId  = null;
      });
    });
  }

  // 〓〓〓〓〓〓 テーブル加工機能 〓〓〓〓〓〓

  function processTable(id){
    const table = document.getElementById(id);
    if (!table || !table.tHead) return;
    table.style.margin = '8px 0 24px';
    const colMap = columnIds[id];
    // タイトル挿入
    if (!document.getElementById(titleMap[id])){
      const h3 = document.createElement('h3');
      h3.id = titleMap[id];
      h3.textContent = labelMap[id];
      Object.assign(h3.style,{margin:'0',padding:'0'});
      table.insertAdjacentElement('beforebegin', h3);
    }
    const headerRow = table.tHead.rows[0];
    const hdrs = Array.from(headerRow.cells);
    // テーブルごとにソート関数初期化
    dbeClearSortHistory(id);

    // ヘッダー整形
    hdrs.forEach(th=>{
      th.style.backgroundColor = '#F0F0F0';
      th.style.color           = '#000';
      th.style.cursor          = 'default';
      const cls = colMap[th.textContent.trim()];
      if (cls) th.classList.add(cls);
    });
    const idxMap = {};
    hdrs.forEach((th,i)=>{
      const t = th.textContent.trim();
      if (colMap[t]) idxMap[t] = i;
    });
    
    // 〓〓〓〓〓 名称ヘッダー（武器/防具）に 4段階サイクルソートをワイヤリング 〓〓〓〓〓
    wireNameColumnSort(table, id, idxMap, hdrs, headerRow);

    // 〓〓〓〓〓 「解」列ヘッダークリック：2段階（昇順/降順）＋インジケーターは右固定 〓〓〓〓〓
    const lockIdx = idxMap['解'];
    if (lockIdx != null) {
      const th = hdrs[lockIdx];
      th.style.cursor = 'pointer';

      // ソート状態: true=逆順, false=正順（インジケーターは右固定）
      let lockDesc = true;

      // 共通：マリモ列インデックス
      const mrimIdx = idxMap['マリモ'];
      // テーブル別：ランク／レアリティ列インデックス
      const nameIdx = id === 'necklaceTable'
        ? idxMap['ネックレス']
        : id === 'weaponTable'
        ? idxMap['武器']
        : idxMap['防具'];

      const sortByUnlock = (desc) => {
        const rows = Array.from(table.tBodies[0].rows);
        rows.sort((a,b)=>{
          // 1) 解リンク順
          const aKey = a.cells[lockIdx].hasAttribute('secured') ? 'secured'
                      : a.cells[lockIdx].hasAttribute('released') ? 'released'
                      : null;
          const bKey = b.cells[lockIdx].hasAttribute('secured') ? 'secured'
                      : b.cells[lockIdx].hasAttribute('released') ? 'released'
                      : null;
          const aSec = secrOrder[aKey] ?? 0;
          const bSec = secrOrder[bKey] ?? 0;

          // 2) ランク or レアリティ
          const aRank = id === 'necklaceTable'
            ? (gradeOrder[(a.cells[nameIdx].textContent.match(/Pt|Au|Ag|CuSn|Cu/)||['Cu'])[0]] || 0)
            : (rarityOrder[(dbePickRarityFromText(a.cells[nameIdx].textContent) || 'N')] || 0);
          const bRank = id === 'necklaceTable'
            ? (gradeOrder[(b.cells[nameIdx].textContent.match(/Pt|Au|Ag|CuSn|Cu/)||['Cu'])[0]] || 0)
            : (rarityOrder[(dbePickRarityFromText(b.cells[nameIdx].textContent) || 'N')] || 0);

          // 3) マリモ値
          const aMr = parseInt(a.cells[mrimIdx].textContent.replace(/\D/g,''),10) || 0;
          const bMr = parseInt(b.cells[mrimIdx].textContent.replace(/\D/g,''),10) || 0;

          // 「解→ランク→マリモ」を、全体として昇順/降順の2択に統一
          return desc
            ? ((bSec - aSec) || (bRank - aRank) || (bMr - aMr))
            : ((aSec - bSec) || (aRank - bRank) || (aMr - bMr));
        });

        // 行を再描画
        rows.forEach(r => table.tBodies[0].appendChild(r));

        // インジケーターは右固定
        updateSortIndicator(th, desc ? '⬆' : '⬇', 'right');
      };

      th.addEventListener('click', () => {
        const appliedDesc = lockDesc;
        sortByUnlock(appliedDesc);

        // 「再読込」後の再適用用として履歴に登録（同一列キーは最後の方向だけ残す）
        dbeRememberSort(id, () => sortByUnlock(appliedDesc), 'KAI');

        // 次回クリックは反転
        lockDesc = !lockDesc;
        clearAnchorCellMemory();
      });
    }

    // 〓〓〓〓〓 増減列追加＆フィルターUI 〓〓〓〓〓
    if (id==='necklaceTable'){
      // --- 安全な挿入位置の決定（'属性' が見つからない場合は末尾に追加） ---
      const attrIdxByMap = Number.isInteger(idxMap['属性']) ? idxMap['属性'] : -1;
      const attrIdxByText = (() => {
        const hdrCells = Array.from(headerRow.cells);
        return hdrCells.findIndex(th => (th.textContent||'').trim() === '属性');
      })();
      const attrIdx = (attrIdxByMap >= 0 ? attrIdxByMap : (attrIdxByText >= 0 ? attrIdxByText : headerRow.cells.length - 1));
      const pos = Math.max(0, Math.min(headerRow.cells.length, attrIdx + 1));
      // 「装」列（necClm-Equp）インデックスを動的に検出（見つからなければ -1）
      const equpIdx = (() => {
        const hdrCells2 = Array.from(headerRow.cells);
        const idx = hdrCells2.findIndex(th => (th.textContent || '').trim() === '装');
        return (idx >= 0 ? idx : -1);
      })();
      // アイテムIDフィルター用の入力＆チェックボックス（applyFilter から参照するためスコープだけ先に用意）
      let idNum = null;
      let idChk = null;

      // 〓〓〓〓〓 列クラス名（未定義対策のフォールバック） 〓〓〓〓〓
      const deltaColClass = (columnIds && columnIds.necklaceTable && columnIds.necklaceTable['増減']) ? columnIds.necklaceTable['増減'] : 'neckClm-Delta';
      // ①重複防止：既存の「増減」列（ヘッダ/セル）を全て除去してから再構築
      try{
        table.querySelectorAll('th.'+deltaColClass+', td.'+deltaColClass).forEach(el=>el.remove());
      }catch(_){}
      // ②表示設定：OFFなら再構築せずスキップ（lastSortMapもクリア）
      const __showDelta = (typeof readBool==='function') ? readBool('showDelta') : true;
      if (__showDelta) {
      // 増減列ヘッダー
      const dTh = document.createElement('th');
      dTh.classList.add(deltaColClass);
      dTh.textContent='増減';
      Object.assign(dTh.style,{backgroundColor:'#F0F0F0',color:'#000',textAlign:'center',cursor:'pointer'});
      const thRef = headerRow.cells[pos] || null;
      thRef ? headerRow.insertBefore(dTh, thRef) : headerRow.appendChild(dTh);
              // 原則：'use strict' 直下で定義された buffKeywords / debuffKeywords を必ず使う
              const _buff   = Array.isArray(buffKeywords)   ? buffKeywords   : [];
              const _debuff = Array.isArray(debuffKeywords) ? debuffKeywords : [];
      // 各行に計算セル
      Array.from(table.tBodies[0].rows).forEach(row=>{
        const td = document.createElement('td');
        td.classList.add(deltaColClass);
        td.style.textAlign='center';
        const tdRef = row.cells[pos] || null;
        tdRef ? row.insertBefore(td, tdRef) : row.appendChild(td);
        let tot = 0;
        const attrCell = row.cells[attrIdx];
        if (attrCell){
          attrCell.querySelectorAll('li').forEach(li=>{
            const value = dbeGetNecklaceAttrDeltaValue(li, _buff, _debuff);
            if (typeof value === 'number' && Number.isFinite(value)) tot += value;
          });
        }
        td.textContent = tot>0? ('△'+tot) : (tot<0? ('▼'+Math.abs(tot)) : '0');
      });

      // 〓〓〓〓〓 ソート（△はプラス、▼はマイナス）＋ インジケーター表示 〓〓〓〓〓
      // ascNum=true：逆順（tot 大→小）、ascNum=false：正順（tot 小→大）
      let ascNum = true;
      // ネックレス「増減」列の最後のソート方向を記憶（true=逆順(⬆), false=正順(⬇)）
      let necklaceLastSortDirection = null;
      const sortByDelta = (useAsc) => {
        const rows = Array.from(table.tBodies[0].rows);
        rows.sort((a, b) => {
          const txtA = (a.cells[pos]?.textContent||'').trim();
          const txtB = (b.cells[pos]?.textContent||'').trim();
          const va = txtA.startsWith('△') ? parseInt(txtA.slice(1),10)
                  : txtA.startsWith('▼') ? -parseInt(txtA.slice(1),10) : 0;
          const vb = txtB.startsWith('△') ? parseInt(txtB.slice(1),10)
                  : txtB.startsWith('▼') ? -parseInt(txtB.slice(1),10) : 0;
          return useAsc ? (vb - va) : (va - vb);
        });
        rows.forEach(r => table.tBodies[0].appendChild(r));
        // インジケーター更新（このヘッダー行内の既存を除去してから付与）
        (headerRow.closest('tr')||headerRow).querySelectorAll('.sort-indicator, .sort-indicator-left').forEach(el => el.remove());
        updateSortIndicator(dTh, useAsc ? '⬆' : '⬇', 'right');
        clearAnchorCellMemory();
      };

      dTh.addEventListener('click', () => {
        // 現在のクリックで適用される方向でソートし、記憶
        const appliedDir = ascNum;
        sortByDelta(appliedDir);
        necklaceLastSortDirection = appliedDir;
        // 再適用用（＆多段復元の履歴）として登録
        dbeRememberSort(id, () => sortByDelta(appliedDir), 'DELTA');
        // 次回クリックは反転
        ascNum = !appliedDir;
      });
      } else {
        try{ dbeClearSortHistory(id); }catch(_){}
      }

      // 〓〓〓〓〓 フィルター UI 〓〓〓〓〓
      // 重複ガード：テーブル直前に既存のフィルターUI(.filter-ui / .dbe-necklace-filter)があれば全て掃除
      try{
        let probe = table.previousElementSibling;
        while (probe && probe.classList && (probe.classList.contains('filter-ui') || probe.classList.contains('dbe-necklace-filter'))) {
          const prev = probe.previousElementSibling;
          probe.remove();
          probe = prev;
        }
      }catch(err){
        console.warn('[DBE] cleanup necklace filter-ui failed:', err);
      }
      // ラッパー（この中に「ボタン行」「アイテムIDフィルター行」「チェックボックス行」を縦に配置）
      const wrap = document.createElement('div');
      wrap.className = 'dbe-necklace-filter';
      Object.assign(wrap.style, {
        display:'flex',
        flexDirection:'column',
        gap:'4px',
        alignItems:'flex-start',
        margin:'0px'
      });

      // ボタン行：《全解除》《再読込》
      const rowButtons = document.createElement('div');
      rowButtons.style.display = 'flex';
      rowButtons.style.gap = '8px';
      rowButtons.style.margin = '0px';

      const chks=[];
      async function dbeSoftReloadThisNecklaceTable(btn){
        let oldText = '';
        try{
          if (table.dataset.dbeSoftReloading === '1') return;
          table.dataset.dbeSoftReloading = '1';
          oldText = btn ? btn.textContent : '';
          if (btn){ btn.disabled = true; btn.textContent = '更新中...'; }

          const ok = await dbeSoftReloadTableTbody(id);
          if (!ok) throw new Error('tbody reload failed');

          // Settings に存在する項目は、再読込直前のテーブル構造ではなく
          // #dbe-W-Settings の保存値を優先して再構成する。
          try{
            dbeApplySettingsDrivenTableStructure(id);
          }catch(err){
            console.warn('[DBE] apply settings-driven structure for necklaceTable failed:', err);
          }

          // フィルター＆（必要なら）最後のソートを再適用
          applyFilter();
          try{ applyCellColors(); }catch(_){}
        }catch(err){
          console.warn('[DBE] soft reload necklaceTable failed:', err);
          location.reload();
        }finally{
          try{ delete table.dataset.dbeSoftReloading; }catch(_){ table.dataset.dbeSoftReloading=''; }
          if (btn){
            btn.disabled = false;
            btn.textContent = oldText || '再読込';
          }
        }
      }

      [['全解除',()=>{ chks.forEach(c=>c.checked=false); if (idChk) idChk.checked=false; applyFilter(); }],
        ['再読込',(ev)=>{ Promise.resolve(dbeSoftReloadThisNecklaceTable(ev && ev.currentTarget)).catch(_=>{}); }]]
        .forEach(([t,fn])=>{
          const b=document.createElement('button');
          b.textContent=t;
          Object.assign(b.style,{fontSize:'0.9em',padding:'4px 8px',margin:'10px'});
          b.addEventListener('click',fn);
          rowButtons.appendChild(b);
        });

      // アイテムIDフィルターの行：《アイテムID：[textbox] 以上を抽出する [checkbox]》
      const rowItemFilter = document.createElement('div');
      Object.assign(rowItemFilter.style, {
        marginTop:'4px',
        display:'flex',
        alignItems:'center',
        gap:'8px',
        flexWrap:'wrap'
      });
      const idLbl1 = document.createElement('span');
      idLbl1.textContent = 'アイテムID：';
      idLbl1.style.fontSize = '1.0em';
      idNum = document.createElement('input');
      idNum.type = 'text';
      idNum.style.width = '10em';
      idNum.style.margin = '0';
      idNum.style.padding = '2px 8px';
      idNum.style.fontSize = '0.9em';
      // デフォルトのしきい値をテキストボックスの初期値として設定
      idNum.value = String(DEFAULT_ITEMIDFILTER_THRESHOLD);
      const idLbl2 = document.createElement('span');
      idLbl2.textContent = '以上を抽出する';
      idChk = document.createElement('input');
      idChk.type = 'checkbox';
      idChk.checked = false;
      // 変更反映
      idChk.addEventListener('change', ()=>{ applyFilter(); });
      idNum.addEventListener('input',  ()=>{ if (idChk && idChk.checked) applyFilter(); });
      rowItemFilter.append(idLbl1, idNum, idLbl2, idChk);

      // チェックボックス行（攻撃の嵐、元素の混沌、破滅の打撃…）
      const sc=document.createElement('div');
      sc.style.display='flex';
      sc.style.flexWrap='wrap';
      sc.style.gap='8px';
      sc.style.margin='4px 0 0 0';
      // ラベル集合：statusMap が未定義なら、テーブルから動的抽出
      const dynamicLabels = (()=> {
        const s=new Set();
        Array.from(table.tBodies[0].rows).forEach(r=>{
          const cell = r.cells[attrIdx];
          if (!cell) return;
          cell.querySelectorAll('li').forEach(li=>{
            const m = (li.textContent||'').trim().match(/(\d+)%\s*(.+)$/);
            if (m) s.add(m[2].trim());
          });
        });
        return Array.from(s);
      })();
      const labels = (typeof statusMap!=='undefined' && statusMap && typeof statusMap==='object')
                    ? Object.keys(statusMap) : dynamicLabels;
      labels.forEach(label=>{
        const lb=document.createElement('label');
        lb.style.fontSize='1.0em';
        const ck=document.createElement('input');
        ck.type='checkbox';
        ck.value=label;
        ck.checked=false;
        ck.addEventListener('change',applyFilter);
        chks.push(ck);
        lb.append(ck,document.createTextNode(' '+label));
        sc.appendChild(lb);
      });

      // ラッパーに「ボタン行」「アイテムID行」「チェックボックス行」を順番に追加して、テーブル直前へ挿入
      wrap.append(rowButtons, rowItemFilter, sc);
      table.insertAdjacentElement('beforebegin', wrap);

      function applyFilter(){
        const act = chks.filter(c=>c.checked).map(c=>c.value);
        // アイテムIDのしきい値（入力値が空 or 数字でない場合はデフォルト値）
        const useIdFilter = !!(idChk && idChk.checked);
        let threshold = DEFAULT_ITEMIDFILTER_THRESHOLD;
        if (useIdFilter && idNum){
          const raw = (idNum.value || '').trim();
          const m = raw.match(/\d+/);
          if (m){
            const v = parseInt(m[0],10);
            if (!Number.isNaN(v)) threshold = v;
          }
        }
        Array.from(table.tBodies[0].rows).forEach(r=>{
          let visible = true;
          // ステータス（属性）フィルター
          if (act.length > 0){
            const txt = (r.cells[attrIdx]?.textContent) || '';
            if (!act.every(a=>txt.includes(a))) visible = false;
          }
          // アイテムIDフィルター（necClm-Equp 列を参照）
          if (visible && useIdFilter && equpIdx >= 0){
            const cell = r.cells[equpIdx] || null;
            const idStr = extractItemIdFromEqupCell(cell);
            if (idStr){
              const val = parseInt(idStr,10);
              if (!Number.isNaN(val) && val < threshold){
                visible = false;
              }
            }
          }
          r.style.display = visible ? '' : 'none';
        });
      }
      applyFilter();
        // フィルター後：保存済みのソート履歴（多段）を再適用
      dbeApplySortHistory(id);
      scrollToAnchorCell();
    }

// 〓〓〓〓〓 weaponTable 固有 〓〓〓〓〓

    // --- 武器固有：ATK列多段ソート＋インジケーター ---
    if (id === 'weaponTable') {
      const atkIdx = idxMap['ATK'];
      const mrimIdx = idxMap['マリモ'];
      const atkTh = headerRow.cells[atkIdx];
      // ATK列ソート用の状態を管理（4段階）
      let atkState = 0;
      atkTh.style.cursor = 'pointer';
      const sortByAtk = (state) => {
        const rows = Array.from(table.tBodies[0].rows);
        // 既存のインジケーターを全列から削除
        headerRow.querySelectorAll('.sort-indicator, .sort-indicator-left').forEach(el => el.remove());
        switch (state) {
          // (1) 最高ATK値による逆順
          case 0:
            rows.sort((a, b) =>
              parseInt(b.cells[atkIdx].textContent.split('~')[1]) - parseInt(a.cells[atkIdx].textContent.split('~')[1]) ||
              parseInt(b.cells[atkIdx].textContent.split('~')[0]) - parseInt(a.cells[atkIdx].textContent.split('~')[0]) ||
              parseInt(b.cells[mrimIdx].textContent) - parseInt(a.cells[mrimIdx].textContent)
            );
            updateSortIndicator(atkTh, '⬆', 'right');
            break;
          // (2) 最高ATK値による正順
          case 1:
            rows.sort((a, b) =>
              parseInt(a.cells[atkIdx].textContent.split('~')[1]) - parseInt(b.cells[atkIdx].textContent.split('~')[1]) ||
              parseInt(a.cells[atkIdx].textContent.split('~')[0]) - parseInt(b.cells[atkIdx].textContent.split('~')[0]) ||
              parseInt(a.cells[mrimIdx].textContent) - parseInt(b.cells[mrimIdx].textContent)
            );
            updateSortIndicator(atkTh, '⬇', 'right');
            break;
          // (3) 最低ATK値による逆順
          case 2:
            rows.sort((a, b) =>
              parseInt(b.cells[atkIdx].textContent.split('~')[0]) - parseInt(a.cells[atkIdx].textContent.split('~')[0]) ||
              parseInt(b.cells[atkIdx].textContent.split('~')[1]) - parseInt(a.cells[atkIdx].textContent.split('~')[1]) ||
              parseInt(b.cells[mrimIdx].textContent) - parseInt(a.cells[mrimIdx].textContent)
            );
            updateSortIndicator(atkTh, '⬆', 'left');
            break;
          // (4) 最低ATK値による正順
          case 3:
            rows.sort((a, b) =>
              parseInt(a.cells[atkIdx].textContent.split('~')[0]) - parseInt(b.cells[atkIdx].textContent.split('~')[0]) ||
              parseInt(a.cells[atkIdx].textContent.split('~')[1]) - parseInt(b.cells[atkIdx].textContent.split('~')[1]) ||
              parseInt(a.cells[mrimIdx].textContent) - parseInt(b.cells[mrimIdx].textContent)
            );
            updateSortIndicator(atkTh, '⬇', 'left');
            break;
        }
        rows.forEach(r => table.tBodies[0].appendChild(r));
      };

      atkTh.addEventListener('click', () => {
        const appliedState = atkState;
        sortByAtk(appliedState);

        // フィルター／再読込後の再適用用として lastSortMap に登録
        dbeRememberSort(id, () => sortByAtk(appliedState), 'ATK');

        atkState = (atkState + 1) % 4;
        clearAnchorCellMemory();
      });
    }

  // 〓〓〓〓〓 武器固有：SPD列（単独ソート）＋インジケーター 〓〓〓〓〓
    if (id === 'weaponTable') {
      const spdIdx   = idxMap['SPD'];
      const spdTh    = headerRow.cells[spdIdx];

      // ソート状態: true=逆順(大→小), false=正順(小→大)
      let spdDesc = true;
      spdTh.style.cursor = 'pointer';

      const sortBySpd = (desc) => {
        const rows = Array.from(table.tBodies[0].rows);
        rows.sort((a, b) => {
          const aSpd = parseInt((a.cells[spdIdx]?.textContent || '').trim(), 10) || 0;
          const bSpd = parseInt((b.cells[spdIdx]?.textContent || '').trim(), 10) || 0;
          return desc ? (bSpd - aSpd) : (aSpd - bSpd);
        });
        rows.forEach(r => table.tBodies[0].appendChild(r));
        updateSortIndicator(spdTh, desc ? '⬆' : '⬇', 'right');
      };

      spdTh.addEventListener('click', () => {
        // 既存のインジケーターを全体から削除
        headerRow.querySelectorAll('.sort-indicator, .sort-indicator-left').forEach(el => el.remove());

        // ソート実行（SPDのみ）
        const appliedDesc = spdDesc;
        sortBySpd(appliedDesc);

        // 再適用用として lastSortMap に登録
        dbeRememberSort(id, () => sortBySpd(appliedDesc), 'SPD');

        // 次回クリックは反転
        spdDesc = !spdDesc;
        clearAnchorCellMemory();
      });
    }

    // 〓〓〓〓〓 武器固有：CRIT列（単独ソート）＋インジケーター 〓〓〓〓〓
    if (id === 'weaponTable') {
      const critIdx  = idxMap['CRIT'];
      const critTh   = headerRow.cells[critIdx];

      // ソート状態: true=逆順(大→小), false=正順(小→大)
      let critDesc = true;
      critTh.style.cursor = 'pointer';

      const sortByCrit = (desc) => {
        const rows = Array.from(table.tBodies[0].rows);
        rows.sort((a, b) => {
          const aCrit = parseInt((a.cells[critIdx]?.textContent || '').replace(/\D/g, ''), 10) || 0;
          const bCrit = parseInt((b.cells[critIdx]?.textContent || '').replace(/\D/g, ''), 10) || 0;
          return desc ? (bCrit - aCrit) : (aCrit - bCrit);
        });
        rows.forEach(r => table.tBodies[0].appendChild(r));
        updateSortIndicator(critTh, desc ? '⬆' : '⬇', 'right');
      };

      critTh.addEventListener('click', () => {
        // 既存のインジケーターを全体から削除
        headerRow.querySelectorAll('.sort-indicator, .sort-indicator-left').forEach(el => el.remove());

        // ソート実行（CRITのみ）
        const appliedDesc = critDesc;
        sortByCrit(appliedDesc);

        // フィルター後の再適用用として lastSortMap に登録
        dbeRememberSort(id, () => sortByCrit(appliedDesc), 'CRIT');

        // 次回クリックは反転
        critDesc = !critDesc;
        clearAnchorCellMemory();
      });
    }

    // 〓〓〓〓〓 武器固有：MOD列（単独ソート）＋インジケーター 〓〓〓〓〓
    if (id === 'weaponTable') {
      const modIdx  = idxMap['MOD'];
      const modTh   = headerRow.cells[modIdx];

      // ソート状態: true=逆順(大→小), false=正順(小→大)
      let modDesc = true;
      modTh.style.cursor = 'pointer';

      const sortByMod = (desc) => {
        const rows = Array.from(table.tBodies[0].rows);
        rows.sort((a, b) => {
          const aMod = parseInt((a.cells[modIdx]?.textContent || '').replace(/\D/g, ''), 10) || 0;
          const bMod = parseInt((b.cells[modIdx]?.textContent || '').replace(/\D/g, ''), 10) || 0;
          return desc ? (bMod - aMod) : (aMod - bMod);
        });
        rows.forEach(r => table.tBodies[0].appendChild(r));
        updateSortIndicator(modTh, desc ? '⬆' : '⬇', 'right');
      };

      modTh.addEventListener('click', () => {
        // 既存のインジケーターを全体から削除
        headerRow.querySelectorAll('.sort-indicator, .sort-indicator-left').forEach(el => el.remove());

        // ソート実行（MODのみ）
        const appliedDesc = modDesc;
        sortByMod(appliedDesc);

        // フィルター後の再適用用として lastSortMap に登録
        ByMod(appliedDesc);

        // 次回クリックは反転
        modDesc = !modDesc;
        clearAnchorCellMemory();
      });
    }

    // 〓〓〓〓〓 武器固有：マリモ列ソート＋インジケーター 〓〓〓〓〓
    if (id === 'weaponTable') {
      const rrimIdx = idxMap['マリモ'];
      const rrimTh  = headerRow.cells[rrimIdx];
      // マリモ列ソート用フラグ
      let rrimDesc = true;
      rrimTh.style.cursor = 'pointer';
      const sortByRrim = (desc) => {
        const rows = Array.from(table.tBodies[0].rows);
        // 既存の矢印をクリア
        headerRow.querySelectorAll('.sort-indicator, .sort-indicator-left').forEach(el => el.remove());
        // 数値を抜き出してソート
        rows.sort((a, b) => {
          const aVal = parseInt(a.cells[rrimIdx].textContent.replace(/\D/g, ''), 10) || 0;
          const bVal = parseInt(b.cells[rrimIdx].textContent.replace(/\D/g, ''), 10) || 0;
          return desc ? bVal - aVal : aVal - bVal;
        });
        rows.forEach(r => table.tBodies[0].appendChild(r));
        // 矢印表示：右隣に⬆／⬇
        updateSortIndicator(rrimTh, desc ? '⬆' : '⬇', 'right');
      };

      rrimTh.addEventListener('click', () => {
        const appliedDesc = rrimDesc;
        sortByRrim(appliedDesc);

        // フィルター／再読込後の再適用用として lastSortMap に登録
        dbeRememberSort(id, () => sortByRrim(appliedDesc), 'MRIM');

        rrimDesc = !rrimDesc;
        clearAnchorCellMemory();
      });
    }

    // 〓〓〓〓〓 防具固有：DEF列多段ソート＋インジケーター 〓〓〓〓〓
    if (id === 'armorTable') {
      const defIdx = idxMap['DEF'];
      const mrimIdx = idxMap['マリモ'];
      const defTh = headerRow.cells[defIdx];
      // DEF列ソート用の状態を管理（4段階）
      let defState = 0;
      defTh.style.cursor = 'pointer';
      const sortByDef = (state) => {
        const rows = Array.from(table.tBodies[0].rows);
        // 既存のインジケーターを全列から削除
        headerRow.querySelectorAll('.sort-indicator, .sort-indicator-left').forEach(el => el.remove());
        switch (state) {
          // (1) 最高DEF値による逆順
          case 0:
            rows.sort((a, b) =>
              parseInt(b.cells[defIdx].textContent.split('~')[1]) - parseInt(a.cells[defIdx].textContent.split('~')[1]) ||
              parseInt(b.cells[defIdx].textContent.split('~')[0]) - parseInt(a.cells[defIdx].textContent.split('~')[0]) ||
              parseInt(b.cells[mrimIdx].textContent) - parseInt(a.cells[mrimIdx].textContent)
            );
            updateSortIndicator(defTh, '⬆', 'right');
            break;
          // (2) 最高DEF値による正順
          case 1:
            rows.sort((a, b) =>
              parseInt(a.cells[defIdx].textContent.split('~')[1]) - parseInt(b.cells[defIdx].textContent.split('~')[1]) ||
              parseInt(a.cells[defIdx].textContent.split('~')[0]) - parseInt(b.cells[defIdx].textContent.split('~')[0]) ||
              parseInt(a.cells[mrimIdx].textContent) - parseInt(b.cells[mrimIdx].textContent)
            );
            updateSortIndicator(defTh, '⬇', 'right');
            break;
          // (3) 最低DEF値による逆順
          case 2:
            rows.sort((a, b) =>
              parseInt(b.cells[defIdx].textContent.split('~')[0]) - parseInt(a.cells[defIdx].textContent.split('~')[0]) ||
              parseInt(b.cells[defIdx].textContent.split('~')[1]) - parseInt(a.cells[defIdx].textContent.split('~')[1]) ||
              parseInt(b.cells[mrimIdx].textContent) - parseInt(a.cells[mrimIdx].textContent)
            );
            updateSortIndicator(defTh, '⬆', 'left');
            break;
          // (4) 最低DEF値による正順
          case 3:
            rows.sort((a, b) =>
              parseInt(a.cells[defIdx].textContent.split('~')[0]) - parseInt(b.cells[defIdx].textContent.split('~')[0]) ||
              parseInt(a.cells[defIdx].textContent.split('~')[1]) - parseInt(b.cells[defIdx].textContent.split('~')[1]) ||
              parseInt(a.cells[mrimIdx].textContent) - parseInt(b.cells[mrimIdx].textContent)
            );
            updateSortIndicator(defTh, '⬇', 'left');
            break;
        }
        rows.forEach(r => table.tBodies[0].appendChild(r));
      };

      defTh.addEventListener('click', () => {
        const appliedState = defState;
        sortByDef(appliedState);

        // フィルター／再読込後の再適用用として lastSortMap に登録
        dbeRememberSort(id, () => sortByDef(appliedState), 'DEF');

        defState = (defState + 1) % 4;
        clearAnchorCellMemory();
      });
    }

    // 〓〓〓〓〓 防具固有：WT列（単独ソート）＋インジケーター 〓〓〓〓〓
    if (id === 'armorTable') {
      const wgtIdx  = idxMap['WT.'];
      const wgtTh   = headerRow.cells[wgtIdx];

      // ソート状態: true=逆順(大→小), false=正順(小→大)
      let wgtDesc = true;
      wgtTh.style.cursor = 'pointer';

      const sortByWt = (desc) => {
        const rows = Array.from(table.tBodies[0].rows);
        rows.sort((a, b) => {
          const aW = parseFloat((a.cells[wgtIdx]?.textContent || '').trim()) || 0;
          const bW = parseFloat((b.cells[wgtIdx]?.textContent || '').trim()) || 0;
          return desc ? (bW - aW) : (aW - bW);
        });
        rows.forEach(r => table.tBodies[0].appendChild(r));
        updateSortIndicator(wgtTh, desc ? '⬆' : '⬇', 'right');
      };

      wgtTh.addEventListener('click', () => {
        // 既存のインジケーターをクリア
        headerRow.querySelectorAll('.sort-indicator, .sort-indicator-left').forEach(el => el.remove());

        // ソート実行（WTのみ）
        const appliedDesc = wgtDesc;
        sortByWt(appliedDesc);

        // フィルター後の再適用用として lastSortMap に登録
        dbeRememberSort(id, () => sortByWt(appliedDesc), 'WT');

        // 次回クリックは反転
        wgtDesc = !wgtDesc;
        clearAnchorCellMemory();
      });
    }

    // 〓〓〓〓〓 防具固有：CRIT列（単独ソート）＋インジケーター 〓〓〓〓〓
    if (id === 'armorTable') {
      const critIdx  = idxMap['CRIT'];
      const critTh   = headerRow.cells[critIdx];

      // ソート状態: true=逆順(大→小), false=正順(小→大)
      let critDesc = true;
      critTh.style.cursor = 'pointer';

      const sortByCrit = (desc) => {
        const rows = Array.from(table.tBodies[0].rows);
        rows.sort((a, b) => {
          const aCrit = parseInt((a.cells[critIdx]?.textContent || '').replace(/\D/g, ''), 10) || 0;
          const bCrit = parseInt((b.cells[critIdx]?.textContent || '').replace(/\D/g, ''), 10) || 0;
          return desc ? (bCrit - aCrit) : (aCrit - bCrit);
        });
        rows.forEach(r => table.tBodies[0].appendChild(r));
        updateSortIndicator(critTh, desc ? '⬆' : '⬇', 'right');
      };

      critTh.addEventListener('click', () => {
        // 既存のインジケーターをクリア
        headerRow.querySelectorAll('.sort-indicator, .sort-indicator-left').forEach(el => el.remove());

        // ソート実行（CRITのみ）
        const appliedDesc = critDesc;
        sortByCrit(appliedDesc);

        // フィルター後の再適用用として lastSortMap に登録
        dbeRememberSort(id, () => sortByCrit(appliedDesc), 'CRIT');

        // 次回クリックは反転
        critDesc = !critDesc;
        clearAnchorCellMemory();
      });
    }

    // 〓〓〓〓〓 防具固有：MOD列（単独ソート）＋インジケーター 〓〓〓〓〓
    if (id === 'armorTable') {
      const modIdx  = idxMap['MOD'];
      const modTh   = headerRow.cells[modIdx];

      // ソート状態: true=逆順(大→小), false=正順(小→大)
      let modDesc = true;
      modTh.style.cursor = 'pointer';

      const sortByMod = (desc) => {
        const rows = Array.from(table.tBodies[0].rows);
        rows.sort((a, b) => {
          const aMod = parseInt((a.cells[modIdx]?.textContent || '').replace(/\D/g, ''), 10) || 0;
          const bMod = parseInt((b.cells[modIdx]?.textContent || '').replace(/\D/g, ''), 10) || 0;
          return desc ? (bMod - aMod) : (aMod - bMod);
        });
        rows.forEach(r => table.tBodies[0].appendChild(r));
        updateSortIndicator(modTh, desc ? '⬆' : '⬇', 'right');
      };

      modTh.addEventListener('click', () => {
        // 既存のインジケーターを全体から削除
        headerRow.querySelectorAll('.sort-indicator, .sort-indicator-left').forEach(el => el.remove());

        // ソート実行（MODのみ）
        const appliedDesc = modDesc;
        sortByMod(appliedDesc);

        // フィルター後の再適用用として lastSortMap に登録
        dbeRememberSort(id, () => sortByMod(appliedDesc), 'MOD');

        // 次回クリックは反転
        modDesc = !modDesc;
        clearAnchorCellMemory();
      });
    }

    // 〓〓〓〓〓 防具固有：マリモ列ソート＋インジケーター 〓〓〓〓〓
    if (id === 'armorTable') {
      const mrimTh  = headerRow.querySelector('th.amrClm-Mrim');
      const mrimIdx = Array.prototype.indexOf.call(headerRow.cells, mrimTh);
      // マリモ列ソート用フラグ
      let mrimDesc = true;
      mrimTh.style.cursor = 'pointer';
      const sortByMrim = (desc) => {
        const rows = Array.from(table.tBodies[0].rows);
        headerRow.querySelectorAll('.sort-indicator, .sort-indicator-left').forEach(el => el.remove());
        rows.sort((a, b) => {
          const aVal = parseInt(a.cells[mrimIdx].textContent.replace(/\D/g, ''), 10) || 0;
          const bVal = parseInt(b.cells[mrimIdx].textContent.replace(/\D/g, ''), 10) || 0;
          return desc ? bVal - aVal : aVal - bVal;
        });
        rows.forEach(r => table.tBodies[0].appendChild(r));
        updateSortIndicator(mrimTh, desc ? '⬆' : '⬇', 'right');
      };

      mrimTh.addEventListener('click', () => {
        const appliedDesc = mrimDesc;
        sortByMrim(appliedDesc);

        // フィルター／再読込後の再適用用として lastSortMap に登録
        dbeRememberSort(id, () => sortByMrim(appliedDesc), 'MRIM');

        mrimDesc = !mrimDesc;
        clearAnchorCellMemory();
      });
    }
  }

  // 〓〓〓〓〓 weaponTable ＋ armorTable 固有 〓〓〓〓〓
  function wireNameColumnSort(table, id, idxMap, hdrs, headerRow){
    // ネックレス表は除外（個別名なし・別ロジックのため）
    if (id === 'necklaceTable') {
      return; // 既存のネックレス側ロジックに委ねる
    }

    // 武器・防具固有：レアリティ／属性フィルターUI（＋アイテムIDフィルター）
    if (id==='weaponTable'||id==='armorTable') {
      // 既存のフィルターUIが直前にある場合は再利用（中身だけ差し替え）
      let ui = table.previousElementSibling;
      if (ui && ui.classList && ui.classList.contains('filter-ui')) {
        ui.innerHTML = '';
      } else {
        ui = document.createElement('div');
        ui.className='filter-ui';
        ui.style.margin='0px';
        table.insertAdjacentElement('beforebegin',ui);
      }

      async function dbeSoftReloadThisWeaponArmorTable(btn){
        let oldText = '';
        try{
          if (table.dataset.dbeSoftReloading === '1') return;
          table.dataset.dbeSoftReloading = '1';
          oldText = btn ? btn.textContent : '';
          if (btn){ btn.disabled = true; btn.textContent = '更新中...'; }

          const ok = await dbeSoftReloadTableTbody(id);
          if (!ok) throw new Error('tbody reload failed');

          // Settings に存在する項目は、再読込直前のテーブル構造ではなく
          // #dbe-W-Settings の保存値を優先して再構成する。
          try{
            dbeApplySettingsDrivenTableStructure(id);
          }catch(err){
            console.warn('[DBE] apply settings-driven structure for '+id+' failed:', err);
          }

          // フィルター＆最後のソートを維持したまま再適用
          applyFilter();
          try{ applyColor(); }catch(_){}
          try{ applyCellColors(); }catch(_){}
        }catch(err){
          console.warn('[DBE] soft reload '+id+' failed:', err);
          location.reload();
        }finally{
          try{ delete table.dataset.dbeSoftReloading; }catch(_){ table.dataset.dbeSoftReloading=''; }
          if (btn){
            btn.disabled = false;
            btn.textContent = oldText || '再読込';
          }
        }
      }

      const r2=document.createElement('div');
      r2.style.marginTop='4px';
      [['全解除',()=>{setAll(false);try{delete table.dataset.dbeNamePick;}catch(_){table.dataset.dbeNamePick='';}applyFilter();applyColor();}],
        ['再読込',(ev)=>{ Promise.resolve(dbeSoftReloadThisWeaponArmorTable(ev && ev.currentTarget)).catch(_=>{}); }]].forEach(([txt,fn])=>{
        const b=document.createElement('button');
        b.textContent=txt;
        Object.assign(b.style,{fontSize:'0.9em',padding:'4px 8px',margin:'10px'});
        b.addEventListener('click',fn);
        r2.appendChild(b);
      });
      ui.appendChild(r2);

      // 〓〓〓〓〓 アイテムIDフィルターの行（《「全解除」「再読込」》と《Rarity》の間に挿入）〓〓〓〓〓
      const r2_5 = document.createElement('div');
      Object.assign(r2_5.style, { marginTop:'4px', display:'flex', alignItems:'center', gap:'8px', flexWrap:'wrap' });
      const idLbl1 = document.createElement('span'); idLbl1.textContent = 'アイテムID：'; idLbl1.style.fontSize = '1.1em';
      const idNum  = document.createElement('input');
      idNum.type = 'text';                                   // ← number から text に変更
      idNum.id   = 'dbe-filterui-itemidfilter-threshold';
      idNum.value = String(DEFAULT_ITEMIDFILTER_THRESHOLD);
      idNum.style.width = '10em';
      idNum.style.margin = '0';
      idNum.style.padding = '2px 8px';                       // ← 指定の内側余白
      idNum.style.fontSize = '0.9em';
      const idLbl2 = document.createElement('span'); idLbl2.textContent = '以上を抽出する';
      const idChk  = document.createElement('input'); idChk.type = 'checkbox'; idChk.checked = false;
      // 変更反映
      idChk.addEventListener('change', ()=>{ applyFilter(); });
      idNum.addEventListener('input',  ()=>{ if(idChk.checked) applyFilter(); });
      r2_5.append(idLbl1, idNum, idLbl2, idChk);
      ui.appendChild(r2_5);

      // 〓〓〓〓〓 世代フィルターの行（《アイテムID》と《Rarity》の間に挿入）〓〓〓〓〓
      const r2_6 = document.createElement('div');
      Object.assign(r2_6.style, { marginTop:'4px', display:'flex', alignItems:'center', gap:'12px', flexWrap:'wrap' });
      const genLbl = document.createElement('span');
      genLbl.textContent = '世代：';
      genLbl.style.fontSize = '1.1em';
      const synergyLbl = document.createElement('label');
      synergyLbl.style.margin = '0 4px';
      const synergyChk = document.createElement('input');
      synergyChk.type = 'checkbox';
      synergyChk.checked = false;
      synergyChk.addEventListener('change', ()=>{ applyFilter(); });
      synergyLbl.append(synergyChk, document.createTextNode(' SYNERGY'));
      const legacyLbl = document.createElement('label');
      legacyLbl.style.margin = '0 4px';
      const legacyChk = document.createElement('input');
      legacyChk.type = 'checkbox';
      legacyChk.checked = false;
      legacyChk.addEventListener('change', ()=>{ applyFilter(); });
      legacyLbl.append(legacyChk, document.createTextNode(' LEGACY'));
      r2_6.append(genLbl, synergyLbl, legacyLbl);
      ui.appendChild(r2_6);

      const r3=document.createElement('div');
      Object.assign(r3.style,{marginTop:'6px',display:'flex',alignItems:'center'});
      const s3=document.createElement('span'); s3.textContent='Rarity：'; s3.style.fontSize='1.2em';
      r3.appendChild(s3);
      const elm={};
      ['UR','SSR','SR','R','N'].forEach(rk=>{
        const lbl=document.createElement('label');
        lbl.style.margin='0 4px';
        const chk=document.createElement('input');
        chk.type='checkbox';
        chk.checked=false;
        chk.addEventListener('change',applyFilter);
        elm[rk]=chk;
        lbl.append(chk,document.createTextNode(' '+rk));
        r3.appendChild(lbl);
      });
      ui.appendChild(r3);

      const r4=document.createElement('div');
      Object.assign(r4.style,{marginTop:'6px',display:'flex',alignItems:'center'});
      const s4=document.createElement('span'); s4.textContent='Element：'; s4.style.fontSize='1.2em';
      r4.appendChild(s4);
      const rarObj={};
      Object.keys(elemColors).forEach(a=>{
        const lbl=document.createElement('label');
        lbl.style.margin='0 4px';
        const chk=document.createElement('input');
        chk.type='checkbox';
        chk.checked=false;
        chk.addEventListener('change',()=>{applyFilter();applyColor();});
        rarObj[a]=chk;
        lbl.append(chk,document.createTextNode(' '+a));
        r4.appendChild(lbl);
      });
      ui.appendChild(r4);

      const elemCol = idxMap['ELEM'];
      // 以降の 6段階サイクルやメタ抽出で参照する名称列タイトルを明示
      const nameTitle = (id === 'weaponTable') ? '武器' : '防具';
      // 名称セル（レアリティ表記を内包するセル）の列インデックス
      const nameCol   = idxMap[nameTitle];
      const mrimCol   = idxMap['マリモ'];
      let ascMulti = true;

      // 〓〓〓〓〓 名称列セルクリック：同名装備の抽出（weaponTable / armorTable） 〓〓〓〓〓
      // table.dataset.dbeNamePick に「抽出対象のアイテム名」を保持（同名を再クリックで解除）
      function dbeGetPureNameFromNameCell(td){
        try{
          const parsed = (typeof dbeParseNameTd === 'function') ? dbeParseNameTd(td) : null;
          const nm = (parsed && parsed.name != null) ? String(parsed.name).trim() : '';
          if (nm) return nm;
        }catch(_){}
        const txt = (td && td.textContent) ? String(td.textContent).trim() : '';
        if (!txt) return '';
        return dbeStripLegacyGenerationMark(txt.split('\n')[0].split('【')[0].trim());
      }

      function dbeIsLegacyGenerationRow(row){
        try{
          const parsed = (typeof dbeParseNameTd === 'function') ? dbeParseNameTd(row.cells[nameCol]) : null;
          if (parsed && parsed.kind && parsed.kind !== 'necklace') return !!parsed.legacy;
        }catch(_){}
        const cell = row && row.cells ? row.cells[nameCol] : null;
        const firstSpan = cell ? cell.querySelector('span') : null;
        const rawName = (firstSpan ? firstSpan.textContent : (cell ? cell.textContent : '')).trim();
        return dbeIsLegacyGenerationName(rawName.split('\n')[0].split('【')[0].trim());
      }

      function setAll(v){
        Object.values(elm).forEach(x=>x.checked=v);
        Object.values(rarObj).forEach(x=>x.checked=v);
        synergyChk.checked = v;
        legacyChk.checked = v;
      }
      function applyColor(){ Array.from(table.tBodies[0].rows).forEach(r=>{ const v=r.cells[elemCol].textContent.replace(/[0-9]/g,'').trim()||'なし'; r.cells[elemCol].style.backgroundColor=elemColors[v]; }); }
      function applyFilter(){
        const selectedRarities = Object.keys(elm).filter(rk=>elm[rk].checked);
        const selectedElements = Object.keys(rarObj).filter(el=>rarObj[el].checked);
        const pickedName = (table.dataset.dbeNamePick || '').trim();
        const useGenerationFilter = (synergyChk.checked !== legacyChk.checked);
        // アイテムIDしきい値の取得（チェックON時のみ使用）
        // 仕様：weaponTable -> necClm-Equp 列、armorTable -> amrClm-Equp 列を参照
        // 実装：実セルから /equip/NNNNNN のリンクを直接抽出（列名変化に強い）
        const useIdFilter = !!idChk.checked;
        // UI から取得（見つからない場合は共通定義のデフォルトを使用）
        const uiInput = document.getElementById('dbe-filterui-itemidfilter-threshold');
        const rawIdInput = (uiInput?.value ?? '');
        // テキストボックスでも安定動作：先頭の数値列を抽出してパース（見つからない場合はデフォルト値）
        const idThreshold = (useIdFilter
          ? (parseInt((rawIdInput.match(/\d+/) || [''])[0], 10) || DEFAULT_ITEMIDFILTER_THRESHOLD)
          : null);

        Array.from(table.tBodies[0].rows).forEach(row=>{
          // 名称セルからレアリティを抽出
          const rt = dbePickRarityFromText(row.cells[nameCol].textContent) || 'N';
          const el = (row.cells[elemCol].textContent.replace(/[0-9]/g,'').trim()||'なし');
          const okR = selectedRarities.length === 0 || selectedRarities.includes(rt);
          const okE = selectedElements.length === 0 || selectedElements.includes(el);
          let okN = true;
          if (pickedName){
            const rowName = dbeGetPureNameFromNameCell(row.cells[nameCol]);
            okN = (rowName === pickedName);
          }

          // 世代フィルター：
          // - 両方OFF / 両方ON は無効
          // - LEGACYのみON   => 旧世代（末尾 * あり）のみ表示
          // - SYNERGYのみON  => 新世代（末尾 * なし）のみ表示
          let okGen = true;
          if (useGenerationFilter){
            const isLegacy = dbeIsLegacyGenerationRow(row);
            okGen = legacyChk.checked ? isLegacy : !isLegacy;
          }

          // アイテムIDフィルター：チェックON時のみ評価
          let okId = true;
          if (useIdFilter) {
            // 行内の equip リンクから数値IDを抽出（例：/equip/69366417）
            const equipA = row.querySelector('a[href*="/equip/"]');
            const href = equipA?.getAttribute('href') || '';
            const m = href.match(/\/equip\/(\d+)/);
            const itemId = m ? parseInt(m[1], 10) : NaN;
            // 数値化できない場合は「通す」、数値化できた場合のみしきい値と比較
            okId = Number.isNaN(itemId) ? true : (itemId >= idThreshold);
          }

          row.style.display = (okR && okE && okGen && okId && okN) ? '' : 'none';
        });

        applyColor();
        // フィルター後：保存済みのソート履歴（多段）を再適用
        dbeApplySortHistory(id);
        scrollToAnchorCell();
      }

      // 〓〓〓〓〓 名称列セルクリックで「同名のみ表示」フィルターを切替 〓〓〓〓〓
      // （weaponTable / armorTable）既存の名称セルクリック処理は廃止し、ここで一元的に扱う
      if (!table.dataset.dbeNamePickWired){
        table.dataset.dbeNamePickWired = '1';
        // 見た目（クリック可能）
        try{
          Array.from(table.tBodies[0].rows).forEach(r=>{
            const c = r.cells[nameCol];
            if (c) c.style.cursor = 'pointer';
          });
        }catch(_){}
        table.addEventListener('click', (ev)=>{
          try{
            const a = ev.target.closest && ev.target.closest('a[href]');
            if (a) return; // リンク操作は邪魔しない
            const td = ev.target.closest && ev.target.closest('td');
            if (!td) return;
            const tr = td.closest && td.closest('tr');
            if (!tr || !table.tBodies || !table.tBodies[0] || tr.parentElement !== table.tBodies[0]) return;
            const idx = Array.prototype.indexOf.call(tr.cells, td);
            if (idx !== nameCol) return;
            ev.preventDefault(); ev.stopPropagation();
            recordClickedCell(td, table);
            const picked = dbeGetPureNameFromNameCell(td);
            if (!picked) return;
            if ((table.dataset.dbeNamePick || '') === picked){
              try{ delete table.dataset.dbeNamePick; }catch(_){ table.dataset.dbeNamePick=''; }
            } else {
              table.dataset.dbeNamePick = picked;
            }
            applyFilter();
          }catch(_){}
        }, {passive:false});
      }

      // ELEM列：Element（火/氷/雷/風/地/水/光/闇/なし）→ 数値（大→小）でソート
      // ※Element「なし」は直前の並び（直前ソート結果）を維持（相対順序を変えない）
      // ※クリックの昇順/逆順は「Element順のみ」を反転し、数値順（大→小）は固定
      function sortByElemHeader(ascElemOrder){
        const rows = Array.from(table.tBodies[0].rows).filter(r=>r.style.display!=='none');

        // 「なし」の相対順序を確実に維持するため、現在表示順を退避（安定ソート用）
        const prevIndex = new Map();
        rows.forEach((r,i)=>prevIndex.set(r,i));

        // Element順（昇順の基準）
        const elemSeq = ['火','氷','雷','風','地','水','光','闇','なし'];
        const rankOf = (elem)=>{
          const k = elemSeq.indexOf(elem);
          return (k >= 0) ? k : elemSeq.length;
        };

        // ELEMセルから {elem, num} を抽出
        function parseElemCellText(text){
          const t = (text || '').trim();
          if (!t || t === 'なし') return { elem:'なし', num:null };

          // 例: "25風" / "54氷"
          let m = t.match(/^\s*(\d+)\s*([火氷雷風地水光闇])\s*$/);
          if (m) return { elem:m[2], num:(parseInt(m[1],10) || 0) };

          // 念のためのフォールバック（数字＋属性がどこかに含まれている場合）
          m = t.match(/(\d+)\s*([火氷雷風地水光闇])/);
          if (m) return { elem:m[2], num:(parseInt(m[1],10) || 0) };

          // 属性だけが入っている場合は数値0扱い（通常は来ない想定）
          m = t.match(/([火氷雷風地水光闇])/);
          if (m) return { elem:m[1], num:0 };

          return { elem:'なし', num:null };
        }

        rows.sort((a,b)=>{
          const A = parseElemCellText(a.cells[elemCol]?.textContent);
          const B = parseElemCellText(b.cells[elemCol]?.textContent);

          // (1) Element順（クリックで昇順/逆順）
          const ra = rankOf(A.elem);
          const rb = rankOf(B.elem);
          let d = ascElemOrder ? (ra - rb) : (rb - ra);
          if (d) return d;

          // (2) 同Element内：数値 大→小（固定）
          // ただし Element「なし」は直前の並びを維持（＝相対順序を変えない）
          if (A.elem === 'なし') {
            return (prevIndex.get(a) ?? 0) - (prevIndex.get(b) ?? 0);
          }

          const na = (A.num == null) ? 0 : A.num;
          const nb = (B.num == null) ? 0 : B.num;
          d = (nb - na);
          if (d) return d;

          // 仕上げ：同値は直前の並びで安定化
          return (prevIndex.get(a) ?? 0) - (prevIndex.get(b) ?? 0);
        });

        rows.forEach(r=>table.tBodies[0].appendChild(r));
      }

      // ELEM列ヘッダークリック時はフィルターではなく ELEM 専用ソートのみ実行
      // ELEM列ソート用の状態を管理
      let elemState = 0; // 0=昇順, 1=降順
      hdrs[elemCol].style.cursor = 'pointer';
      hdrs[elemCol].addEventListener('click', () => {
        // 既存のインジケーターを全列から削除
        headerRow.querySelectorAll('.sort-indicator, .sort-indicator-left').forEach(el => el.remove());
        // ソート実行
        const appliedState = elemState;
        sortByElemHeader(appliedState === 0);
        // インジケーター更新
        updateSortIndicator(hdrs[elemCol], appliedState === 0 ? '⬆' : '⬇', 'right');
        // ソート状態を保存
        const lastState = appliedState;
        dbeRememberSort(id, () => {
          sortByElemHeader(lastState === 0);
          updateSortIndicator(hdrs[elemCol], lastState === 0 ? '⬆' : '⬇', 'right');
          applyColor(); clearAnchorCellMemory();
        }, 'ELEM');
        elemState = elemState === 0 ? 1 : 0;
        applyColor();
        clearAnchorCellMemory();
      });

      // --- ELEM列セルクリックによるフィルター→ソート→スクロール ---
      Array.from(table.tBodies[0].rows).forEach(row=>{
        const cell = row.cells[elemCol];
        cell.style.cursor = 'pointer';
        cell.addEventListener('click',()=>{
          // クリックしたセルを記憶
          recordClickedCell(cell, table);
          // クリックしたセルから「火,氷…なし」を抽出
          const clicked = (cell.textContent.match(/[^\d]+$/)||['なし'])[0];
          // 対応するチェックボックスだけONに
          Object.keys(rarObj).forEach(el=> rarObj[el].checked = (el === clicked));
          // フィルタ・色・ソート・スクロール
        applyFilter();
        applyColor();
        scrollToAnchorCell();
        });
      });

      // 〓〓〓〓〓〓 4 段階サイクル（①〜④）【v14.1.3.1】〓〓〓〓〓〓
      // 対象：weaponTable の wepClm-Name / armorTable の amrClm-Name
      // 方針：
      //   - 名称列クリック時は「レジストリの kana」を基準にソートする
      //   - レジストリ未登録行は先頭グループにまとめ、未登録行同士は表示名でフォールバックソートする
      //   - ただし kana/表示名 同値内では Rarity 降順を適用する
      //   - さらに kana/表示名/Rarity まで同値の場合のみ、既存の並び（＝過去のソート履歴の結果）を保持する
      //   - 半角全角は NFKC で同等扱い
      //   - 4段階サイクルは下記
      //       0 = ↓ 限定 … 未登録 → イベント中装備(kana昇順相当) → 限定装備(kana昇順相当) → 常設装備(kana昇順相当)
      //       1 = ↑ 限定 … 未登録 → イベント中装備(kana降順相当) → 限定装備(kana降順相当) → 常設装備(kana降順相当)
      //       2 = ↓ カナ  … 未登録 → 登録済みをカテゴリ非区別で kana昇順相当
      //       3 = ↑ カナ  … 未登録 → 登録済みをカテゴリ非区別で kana降順相当

      const nameThOrig  = hdrs[idxMap[nameTitle]];
      const nameTh      = nameThOrig.cloneNode(true);
      nameThOrig.parentNode.replaceChild(nameTh, nameThOrig);
      nameTh.style.cursor = 'pointer';
      if (!table.dataset.nameSortPhase) table.dataset.nameSortPhase = '0';
      if (!table.dataset.nameSortLastApplied) table.dataset.nameSortLastApplied = '';

      const metaCache  = new WeakMap();
      const eventSet   = (id === 'weaponTable') ? eventWeapon : eventArmor;
      const limitedSet = (id === 'weaponTable') ? limitedWeapon : limitedArmor;
      const keyMap     = (id === 'weaponTable') ? weaponKeyToName : armorKeyToName;
      const registry   = (id === 'weaponTable') ? weaponRegistry : armorRegistry;

      function clearNameSortIndicator(){
        const headerRowNow = (nameTh && typeof nameTh.closest === 'function')
          ? nameTh.closest('tr')
          : (table.tHead && table.tHead.rows && table.tHead.rows[0]) || headerRow;
        if (headerRowNow){
          headerRowNow.querySelectorAll('.sort-indicator, .sort-indicator-left, .dbe-name-sort-indicator-exact').forEach(el => el.remove());
        }
      }

      function setNameSortIndicatorExact(label, arrow){
        clearNameSortIndicator();
        const span = document.createElement('span');
        span.className = 'dbe-name-sort-indicator-exact';
        span.style.display = 'inline-flex';
        span.style.alignItems = 'center';
        span.style.gap = '0.1em';
        span.style.marginLeft = '0.35em';
        span.style.color = 'red';
        span.style.fontWeight = 'bold';
        const svg = ARROW_SVG[arrow === '⬇' ? 'down' : 'up'];
        span.innerHTML = `${svg}<span class="sort-label">${label}</span>`;
        nameTh.appendChild(span);
      }

      function normalizeNameForSort(s){
        return String(s || '').normalize('NFKC');
      }

      // 文字カテゴリ:
      //   0=記号
      //   1=数字
      //   2=英字
      //   3=日本語（ひらがな/カタカナ/漢字）
      function charType(ch){
        const cp = ch.codePointAt(0);
        if ((cp >= 0x30A0 && cp <= 0x30FF) || cp === 0x30FC) return 3;
        if (cp >= 0x3040 && cp <= 0x309F) return 3;
        if ((cp >= 0x4E00 && cp <= 0x9FFF) || (cp >= 0x3400 && cp <= 0x4DBF) || (cp >= 0xF900 && cp <= 0xFAFF)) return 3;
        if ((cp >= 0x30 && cp <= 0x39) || (cp >= 0xFF10 && cp <= 0xFF19)) return 1;
        if ((cp >= 0x41 && cp <= 0x5A) || (cp >= 0x61 && cp <= 0x7A) || (cp >= 0xFF21 && cp <= 0xFF3A) || (cp >= 0xFF41 && cp <= 0xFF5A)) return 2;
        return 0;
      }

      function readChunk(s, i, type){
        let j = i;
        if (type === 1){
          while (j < s.length && charType(s[j]) === 1) j++;
          const str = s.slice(i, j);
          const num = Number.parseInt(str, 10);
          return { next:j, type, str, num:Number.isNaN(num) ? 0 : num };
        }
        if (type === 2){
          while (j < s.length && charType(s[j]) === 2) j++;
          return { next:j, type, str:s.slice(i, j) };
        }
        if (type === 3){
          while (j < s.length && charType(s[j]) === 3) j++;
          return { next:j, type, str:s.slice(i, j) };
        }
        while (j < s.length && charType(s[j]) === 0) j++;
        return { next:j, type, str:s.slice(i, j) };
      }

      function compareChunkCore(A, B, type, reverseWithinType){
        if (type === 1){
          if (A.num !== B.num) return reverseWithinType ? (B.num - A.num) : (A.num - B.num);
          if (A.str.length !== B.str.length) return reverseWithinType ? (B.str.length - A.str.length) : (A.str.length - B.str.length);
          return reverseWithinType
            ? B.str.localeCompare(A.str, 'ja', { sensitivity:'base', numeric:true })
            : A.str.localeCompare(B.str, 'ja', { sensitivity:'base', numeric:true });
        }
        if (type === 2 || type === 3){
          return reverseWithinType
            ? B.str.localeCompare(A.str, 'ja', { sensitivity:'base', numeric:true })
            : A.str.localeCompare(B.str, 'ja', { sensitivity:'base', numeric:true });
        }
        return reverseWithinType
          ? (A.str > B.str ? -1 : (A.str < B.str ? 1 : 0))
          : (A.str < B.str ? -1 : (A.str > B.str ? 1 : 0));
      }

      // 名称昇順：
      //   記号 → 1→9 → A→Z → あ→ん
      // 名称降順：
      //   ん→あ → Z→A → 9→1 → 記号
      function compareNameOnly(aName, bName, mode){
        const sa = normalizeNameForSort(aName);
        const sb = normalizeNameForSort(bName);
        let ia = 0;
        let ib = 0;
        const rankMap = (mode === 'asc')
          ? { 0:0, 1:1, 2:2, 3:3 }
          : { 3:0, 2:1, 1:2, 0:3 };
        const reverseWithinType = (mode === 'desc');

        while (ia < sa.length && ib < sb.length){
          const ta = charType(sa[ia]);
          const tb = charType(sb[ib]);
          const ra = rankMap[ta];
          const rb = rankMap[tb];
          if (ra !== rb) return ra - rb;

          const ca = readChunk(sa, ia, ta);
          const cb = readChunk(sb, ib, tb);
          const d = compareChunkCore(ca, cb, ta, reverseWithinType);
          if (d) return d;
          ia = ca.next;
          ib = cb.next;
        }
        if (sa.length !== sb.length){
          return reverseWithinType ? (sb.length - sa.length) : (sa.length - sb.length);
        }
        return 0;
      }

      function getMeta(row){
        if (metaCache.has(row)) return metaCache.get(row);
        const cell = row.cells[idxMap[nameTitle]];
        const firstSpan = cell.querySelector('span');
        const rawName = (firstSpan ? firstSpan.textContent : cell.textContent).trim();
        const name = dbeStripLegacyGenerationMark(rawName);
        const legacy = dbeIsLegacyGenerationName(rawName);
        const generation = legacy ? 'legacy' : 'synergy';
        const raw  = cell.textContent;
        const rarity = dbePickRarityFromText(raw) || 'N';
        const canonical = keyMap.get(makeKey(name)) || null;
        const registered = !!canonical;
        const registryMeta = registered ? (registry.get(canonical) || null) : null;
        const kana = (
          registered &&
          registryMeta &&
          typeof registryMeta.kana === 'string' &&
          registryMeta.kana.trim()
        )
          ? registryMeta.kana.trim()
          : name;
        const category = !registered
          ? 'unregistered'
          : eventSet.has(canonical)
          ? 'event'
          : limitedSet.has(canonical)
          ? 'limited'
          : 'regular';
        const limited = (category === 'limited');
        const eventActive = (category === 'event');
        const obj = { row, name, rawName, raw, rarity, canonical, registered, registryMeta, kana, category, limited, eventActive, legacy, generation };
        metaCache.set(row, obj);
        return obj;
      }

      // Rarity降順：UR → N
      function compareRarityDesc(a, b){
        const ra = rarityOrder[a.rarity] ?? 99;
        const rb = rarityOrder[b.rarity] ?? 99;
        return ra - rb;
      }

      function compareGroupForPhase(a, b, phase){
        // phase:
        //   0 = 限定↓
        //   1 = 限定↑
        //   2 = カナ↓
        //   3 = カナ↑
        //
        // 共通：
        //   レジストリ未登録 → レジストリ登録済み
        // phase 0/1:
        //   登録済みの中では イベント中装備 → 限定装備 → 常設装備
        // phase 2/3:
        //   登録済みの中では イベント中/限定/常設を区別しない
        const groupOf = (m)=>{
          if (!m.registered) return 0;
          if (phase === 0 || phase === 1){
            if (m.category === 'event')   return 1;
            if (m.category === 'limited') return 2;
            return 3;
          }
          return 1;
        };
        return groupOf(a) - groupOf(b);
      }

      function applyCycleSort(phase){
        phase = Number.isFinite(phase) ? phase : 0;
        phase = ((phase % 4) + 4) % 4;

        const body = table.tBodies[0];
        const rows = Array.from(body.rows);
        const nameMode = (phase === 0 || phase === 2) ? 'asc' : 'desc';

        rows.sort((ra, rb)=>{
          const a = getMeta(ra);
          const b = getMeta(rb);

          // 1) レジストリ未登録 / 登録済み（必要なら限定/常設まで）
          const g = compareGroupForPhase(a, b, phase);
          if (g) return g;

          // 2) レジストリ登録済みは kana、未登録は表示名をフォールバックとして比較
          const n = compareNameOnly(a.kana, b.kana, nameMode);
          if (n) return n;

          // 3) kana/表示名 同値内だけ Rarity降順
          const r = compareRarityDesc(a, b);
          if (r) return r;

          // 4) ここで 0 を返すことで、kana/表示名/Rarity 同値時のみ既存順（＝ソート履歴）を保持
          return 0;
        });

        rows.forEach(r => body.appendChild(r));

        const indicators = [
          { label:'限定', arrow:'⬇' },
          { label:'限定', arrow:'⬆' },
          { label:'カナ', arrow:'⬇' },
          { label:'カナ', arrow:'⬆' },
        ];
        setNameSortIndicatorExact(indicators[phase].label, indicators[phase].arrow);

        table.dataset.nameSortPhase = String(phase);
        table.dataset.nameSortLastApplied = `name:${phase}`;
        lastSortedColumn  = columnIds[id][nameTitle];
        lastSortAscending = (phase === 0 || phase === 2);
      }

      let nameSortPhase = Number(table.dataset.nameSortPhase || '0');
      nameSortPhase = Number.isFinite(nameSortPhase) ? nameSortPhase : 0;
      nameSortPhase = ((nameSortPhase % 4) + 4) % 4;

      nameTh.addEventListener('click', (ev)=>{
        ev.stopPropagation();
        ev.preventDefault();
        applyCycleSort(nameSortPhase);
        nameSortPhase = (nameSortPhase + 1) % 4;
        table.dataset.nameSortPhase = String(nameSortPhase);
        dbeRememberSort(
          id,
          ()=>applyCycleSort(Number((table.dataset.nameSortLastApplied || 'name:0').split(':')[1])),
          'NAME'
        );
        clearAnchorCellMemory();
      });

      // 〓〓〓〓〓〓 テーブルソート状態の記憶 〓〓〓〓〓〓
      // rankCol（レアリティ列）を安全に取得し、見つからなければ本ブロックはスキップ
      const rankCol = (()=>{
        if (Number.isInteger(idxMap['レアリティ'])) return idxMap['レアリティ'];
        if (Number.isInteger(idxMap['ランク']))     return idxMap['ランク'];
        if (Number.isInteger(idxMap['Rarity']))    return idxMap['Rarity'];
        return -1;
      })();
      if (rankCol >= 0 && table.tBodies && table.tBodies[0]) {
        Array.from(table.tBodies[0].rows).forEach(r=>{
          const cell = r.cells[rankCol];
          cell.style.cursor='pointer';
          cell.addEventListener('click',()=>{
            const clicked=(dbePickRarityFromText(cell.textContent) || 'N');
            // rarity チェック群（elm）が存在する場合のみ同期（未定義でも落ちないように）
            if (typeof elm === 'object' && elm){
              Object.keys(elm).forEach(rk=>{
                if (elm[rk]) elm[rk].checked = (rk === clicked);
              });
            }
            applyColor();
            applyFilter();
            // フィルター後：保存済みのソート履歴（多段）を再適用
            dbeApplySortHistory(id);
            scrollToAnchorCell();
          });
        });
      }

      // 〓〓〓〓〓〓 初期適用：サーバー順を維持して色付けのみ 〓〓〓〓〓〓
      // weapon/armor ブロックでのみ定義される applyColor の未定義参照を回避
      if ((id === 'weaponTable' || id === 'armorTable') && typeof applyColor === 'function') {
        applyColor();
      }

    } // ← wireNameColumnSort の閉じ
  } // ← processTable の閉じ
})(); // ← IIFE の閉じ
