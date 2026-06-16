// 경기도의회 의원활동 언론보도 일일 리포트 (의존성 없음 / Node 18+ 내장 fetch)
// 1) ggc 보도자료(오늘) 수집 → 의원/상임위/직책/정당 파싱
// 2) 의원명으로 네이버 뉴스 검색(k-skill-proxy) → 외부 언론 기사 매칭
// 3) 상임위별 그룹 포맷 텍스트 생성 (카카오 전송용)
const fs = require('fs');
const path = require('path');

const OUT_DIR = process.env.GGC_OUT || process.cwd();
const BASE = 'https://www.ggc.go.kr';
const LIST = BASE + '/site/main/xb/lwmkr/lawmakerpressrelease';
const NAVER = 'https://k-skill-proxy.nomadamas.org/v1/naver-news/search';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';

// 상임위 → 짧은 표기
const SHORT = {
  '의회운영위원회': '의회운영', '기획재정위원회': '기획재정', '경제노동위원회': '경제노동',
  '안전행정위원회': '안전행정', '문화체육관광위원회': '문화체육관광', '농정해양위원회': '농정해양',
  '보건복지위원회': '보건복지', '건설교통위원회': '건설교통', '도시환경위원회': '도시환경',
  '미래과학협력위원회': '미래과학협력', '여성가족평생교육위원회': '여성가족', '교육기획위원회': '교육기획',
  '교육행정위원회': '교육행정',
};
const shortCom = (c) => SHORT[c] || (c ? c.replace(/위원회$/, '') : '기타');

// original_link 도메인 → 언론사명
const OUTLET = {
  'seoul.co.kr': '서울신문', 'kyeongin.com': '경인일보', 'kbs.co.kr': 'KBS',
  'anewsa.com': '아시아뉴스통신', 'sktimes.co.kr': '선경일보', 'newsis.com': '뉴시스',
  'yna.co.kr': '연합뉴스', 'news1.kr': '뉴스1', 'joongang.co.kr': '중앙일보',
  'donga.com': '동아일보', 'chosun.com': '조선일보', 'hani.co.kr': '한겨레',
  'khan.co.kr': '경향신문', 'munhwa.com': '문화일보', 'sedaily.com': '서울경제',
  'mk.co.kr': '매일경제', 'hankyung.com': '한국경제', 'hankookilbo.com': '한국일보',
  'kgnews.co.kr': '경기신문', 'kihoilbo.co.kr': '기호일보', 'kyeonggi.com': '경기일보',
  'incheonilbo.com': '인천일보', 'ggilbo.com': '금강일보', 'breaknews.com': '브레이크뉴스',
  'newspim.com': '뉴스핌', 'asiae.co.kr': '아시아경제', 'ohmynews.com': '오마이뉴스',
  'edaily.co.kr': '이데일리', 'nocutnews.co.kr': '노컷뉴스', 'fnnews.com': '파이낸셜뉴스',
  'jeonmae.co.kr': '전국매일신문', 'metroseoul.co.kr': '메트로신문', 'newsclaim.co.kr': '뉴스클레임',
  'gnews.gg.go.kr': '경기GN', 'joongboo.com': '중부일보', 'kgdm.co.kr': '경기도민일보',
  'newsroad.co.kr': '뉴스로드',
};
function outletName(url) {
  if (!url) return '언론사';
  try {
    let host = new URL(url).hostname.replace(/^www\./, '');
    if (OUTLET[host]) return OUTLET[host];
    const parts = host.split('.');
    for (let i = 0; i < parts.length - 1; i++) {
      const cand = parts.slice(i).join('.');
      if (OUTLET[cand]) return OUTLET[cand];
    }
    return host;
  } catch { return '언론사'; }
}

function todayStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&ldquo;/g, '“').replace(/&rdquo;/g, '”')
    .replace(/&lsquo;/g, '‘').replace(/&rsquo;/g, '’')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n));
}
function htmlToText(html) {
  let t = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
  t = t.replace(/<[^>]+>/g, ' ');
  return decodeEntities(t).replace(/\s+/g, ' ').trim();
}

async function getHtml(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return r.text();
}

// 목록 페이지에서 (제목, href, 날짜) 추출
function parseList(html) {
  const re = /<a href="(\/site\/main\/xb\/lwmkr\/lawmakerpressrelease\/\d+[^"]*)">([\s\S]*?)<\/a>/g;
  const ms = [...html.matchAll(re)];
  const out = [];
  for (let i = 0; i < ms.length; i++) {
    const href = decodeEntities(ms[i][1]);
    const title = htmlToText(ms[i][2]).replace(/새글/g, '').trim();
    const seg = html.slice(ms[i].index, ms[i + 1] ? ms[i + 1].index : ms[i].index + 600);
    const dm = seg.match(/\d{4}-\d{2}-\d{2}/);
    out.push({ title, href, date: dm ? dm[0] : '' });
  }
  return out;
}

// 상세 본문에서 상임위/의원명/직책/정당 파싱
function parseMeta(fullText) {
  const ci = fullText.indexOf('첨부파일');
  const content = ci >= 0 ? fullText.slice(ci) : fullText;
  const m = content.match(/([가-힣]{2,4})\s*(위원장|부위원장|간사|도의원|위원|의원)\s*\(\s*(더불어민주당|국민의힘|개혁신당|진보당|정의당|무소속|[가-힣]+당)\s*,\s*([^)]+?)\)/);
  if (!m) return null;
  const name = m[1];
  const role = (m[2] === '위원' || m[2] === '도의원') ? '의원' : m[2];
  const party = m[3];
  let committee = '';
  let best = Infinity;
  for (const c of Object.keys(SHORT)) {
    const idx = content.indexOf(c);
    if (idx >= 0 && idx < best) { best = idx; committee = c; }
  }
  return { committee, name, role, party };
}

function cleanTitle(title, name) {
  let t = title
    .replace(new RegExp(`^(경기도의회\\s+)?${name}\\s*(경기도의원|도의원|의원|위원장|부위원장|간사)\\s*[,，]?\\s*`), '')
    .replace(/^[“"']/, '')
    .trim();
  if (/[”"]$/.test(t) && !/[“"]/.test(t.slice(0, -1))) t = t.replace(/[”"]$/, '');
  return t;
}

async function searchNaver(name) {
  const q = encodeURIComponent(`${name} 경기도의회`);
  const url = `${NAVER}?q=${q}&display=5&sort=date`;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const j = await r.json();
    const items = j.items || [];
    if (!items.length) return null;
    const named = items.filter((it) => it.title && it.title.includes(name));
    const pick = named[0] || items[0];
    const link = pick.original_link || pick.link;
    return { title: pick.title, url: link, outlet: outletName(link), pub: pick.pub_date_iso };
  } catch { return null; }
}

(async () => {
  const TODAY = process.argv[2] || todayStr();
  const PARTY_FILTER = process.argv[3] || '';
  console.log(`[INFO] 날짜=${TODAY} 정당필터=${PARTY_FILTER || '전체'}`);

  // 1) 오늘자 목록 수집
  const todays = [];
  let stop = false;
  for (let cp = 1; cp <= 50 && !stop; cp++) {
    const html = await getHtml(`${LIST}?listType=list&cp=${cp}`);
    const rows = parseList(html);
    if (!rows.length) break;
    for (const r of rows) {
      if (r.date === TODAY) todays.push(r);
      else if (r.date && r.date < TODAY) stop = true;
    }
    console.log(`[INFO] cp=${cp} 누적 ${todays.length}`);
  }

  // 2) 상세 파싱 + 네이버 검색
  const groups = {};
  const order = [];
  const seen = new Set();
  const seenLink = new Set();
  for (const item of todays) {
    const url = item.href.startsWith('http') ? item.href : BASE + item.href;
    let meta = null;
    try {
      const text = htmlToText(await getHtml(url));
      meta = parseMeta(text);
    } catch (e) { console.log(`[ERR] 상세 로드 실패: ${e.message}`); continue; }
    if (!meta) { console.log(`[SKIP] 의원 파싱 실패: ${item.title.slice(0, 30)}`); continue; }
    if (PARTY_FILTER && meta.party !== PARTY_FILTER) continue;

    const key = `${meta.name}|${item.title}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const article = await searchNaver(meta.name);
    const dedupKey = article ? article.url : url;
    if (seenLink.has(dedupKey)) { console.log(`[DUP] ${meta.name} 동일 링크 생략`); continue; }
    seenLink.add(dedupKey);

    const com = meta.committee || '기타';
    if (!groups[com]) { groups[com] = []; order.push(com); }
    groups[com].push({ ...meta, ggcTitle: item.title, ggcUrl: url, article });
    console.log(`[OK] ${com} / ${meta.name} ${meta.role} (${meta.party}) → ${article ? article.outlet : '기사없음'}`);
  }

  // 3) 포맷 메시지 생성
  const partyLabel = PARTY_FILTER ? `${PARTY_FILTER} ` : '';
  let msg = `〔경기도의회 ${partyLabel}의원활동 언론보도〕\n\n`;
  let total = 0;
  for (const com of order) {
    msg += `<${shortCom(com)}>\n\n`;
    for (const e of groups[com]) {
      total++;
      if (e.article) {
        msg += `○ ${e.name} ${e.role}, ${cleanTitle(e.article.title, e.name)}(${e.article.outlet})\n`;
        msg += `▶ ${e.article.url}\n\n`;
      } else {
        msg += `○ ${e.name} ${e.role}, ${e.ggcTitle}(경기도의회)\n`;
        msg += `▶ ${e.ggcUrl}\n\n`;
      }
    }
  }
  if (total === 0) msg += '오늘 등록된 의원 보도자료가 없습니다.\n';

  msg = msg.trimEnd() + '\n';
  const txtPath = path.join(OUT_DIR, `report_${TODAY}.txt`);
  const jsonPath = path.join(OUT_DIR, `report_${TODAY}.json`);
  fs.writeFileSync(txtPath, msg, 'utf8');
  fs.writeFileSync(jsonPath, JSON.stringify({ date: TODAY, total, order, groups }, null, 2), 'utf8');

  console.log('\n===== REPORT_BEGIN =====');
  console.log(msg.trimEnd());
  console.log('===== REPORT_END =====');
  console.log(`[INFO] TXT_PATH=${txtPath}`);
  console.log(`[INFO] 총 ${total}건 (정당필터: ${PARTY_FILTER || '전체'})`);
})();
