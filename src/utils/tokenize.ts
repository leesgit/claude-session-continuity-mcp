// 공용 쿼리 토큰화 (2026-07-09, audit-7 방안 A)
// 배경: 자동주입 hook(user-prompt-submit)은 어미 절삭 + STOPWORDS + 길이 필터로
//   한국어/다구 검색 품질을 확보하는데, 명시 검색(memory_search)은 raw split(/\s+/)만
//   써서 품질이 낮았다(audit-7 Stage2 실측 CONFIRMED). 이 토큰화를 공용화해 양쪽이 공유한다.

/**
 * Korean + English 일반 stopword
 * (자동주입 트리거 매칭 + 명시 검색 공용)
 */
export const STOPWORDS = new Set<string>([
  // 한국어 빈출 (조사/대명사/일반 동사/부사)
  '있다','없다','하다','되다','이다','아니다','같다','보다','주다','받다','쓰다','놓다',
  '하는','있는','없는','되는','이런','저런','그런','이게','저게','그게','이것','저것','그것',
  '내가','네가','우리','저희','당신','자기','지금','이제','오늘','어제','내일','다음','이전',
  '하나','둘','셋','정말','진짜','아주','너무','매우','조금','약간','대충','그냥','일단',
  '그리고','하지만','그래서','그래도','근데','그런데','또는','또한','이런데','그런데',
  '진행','확인','시작','완료','종료','해줘','해주세요','부탁','알려','알려줘',
  // 흔한 작업 동사·부사
  '저장','기억','삭제','수정','검색','등록','변경','추가','제거','생성','실행','설정',
  '전체','다시','이렇게','그렇게','저렇게','계속','먼저','바로','같이','제대로','하나하나',
  // 범용 명사
  '이름','정보','내용','관련','부분','상태','방법','문제','경우','생각','이야기','얘기',
  '어떻게','무엇','뭐가','왜','어디','언제','어느','어떤','어떻','얼마',
  // 한국어 2글자 빈출
  '이거','그거','저거','한번','두번','코드','작업','뭐했지','뭐였지','봐줘','한거지','했지',
  // 영어 빈출 추가 — Next.js 같은 동음이의 발생하는 토큰
  'next','last','first','prev','previous','check','test','run','live','ready','verify','verification',
  'session','task','item','case','file','line','data','code','word','time','step','part','side',
  // 영어 작업 동사
  'save','store','remember','search','find','delete','remove','update','create','add',
  'change','edit','fix','make','show','list','get','set','build','lint','deploy',
  'whole','thing','again','entire','stuff','something','anything','everything',
  // 영어 빈출 stopwords
  'the','a','an','is','are','was','were','be','been','being','have','has','had',
  'do','does','did','will','would','should','could','can','may','might','must',
  'this','that','these','those','it','its','they','them','their','we','our',
  'you','your','i','my','me','what','when','where','why','how','which','who',
  'and','or','but','if','then','else','also','so','as','at','by','for','from','in','of','on','to','with',
  'just','only','very','really','also','too','still','here','there','now','then',
]);

/**
 * 쿼리/프롬프트에서 의미 있는 한국어/영어 키워드 추출.
 *
 * - 한국어 동사 어미 절삭("저장해줘"→"저장"), 단일 조사(로/를/이/가)는 명사 훼손 방지로 보존
 * - 한국어 2글자 이상, 영어 3글자 이상
 * - STOPWORDS 및 숫자-only 제외
 * - 중복 제거(등장 순서 유지)
 *
 * @param text 원본 문자열
 * @param maxTokens 상한 (자동주입 트리거는 5, 명시 검색은 무제한 = Infinity)
 * @returns 키워드 배열
 */
export function tokenizeQuery(text: string, maxTokens: number = Infinity): string[] {
  if (!text || text.length < 2) return [];

  const cleaned = text
    .replace(/```[\s\S]*?```/g, ' ')        // 코드 블록
    .replace(/`[^`]+`/g, ' ')                // 인라인 코드
    .replace(/^\/[a-z-]+\s*/i, '')           // 슬래시 명령 prefix
    .replace(/[*_~`"'()[\]{}<>]/g, ' ');     // 특수문자

  const tokens = cleaned
    .split(/[\s,.!?;:/\\|]+/)
    .map(t => t.trim().toLowerCase())
    .filter(t => /^[a-z0-9가-힣]+$/i.test(t))
    .map(t => t.replace(/(해줘|해주세요|해주라|했어|했지|하는|하고|해서|합니다|드려|드릴게)$/, ''))
    .filter(t => t.length > 0)
    .filter(t => {
      const hasHangul = /[가-힣]/.test(t);
      return hasHangul ? t.length >= 2 : t.length >= 3;
    })
    .filter(t => !STOPWORDS.has(t))
    .filter(t => !/^\d+$/.test(t));

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const t of tokens) {
    if (!seen.has(t)) {
      seen.add(t);
      unique.push(t);
    }
  }

  return maxTokens === Infinity ? unique : unique.slice(0, maxTokens);
}

/**
 * 영어 토큰의 경량 어간 변형 생성 (2026-07-09, 영어권 유저 고려).
 * FTS5는 정확 일치라 "servers"로 검색하면 "server"로 저장된 메모리를 놓친다.
 * Porter 같은 무거운 stemmer 대신, 흔한 어미(복수 s/es, 과거 ed, 진행 ing)만
 * 벗겨 원형 후보를 만든다. 원형과 변형을 FTS5 OR에 함께 넣어 recall을 높인다.
 *
 * 보수적 규칙 (과절삭 방지):
 *  - 5글자 미만은 건드리지 않음(bus/class 훼손 방지)
 *  - 한글 포함 토큰은 그대로(영어 규칙 미적용)
 *
 * @returns 원형 후보 (없으면 빈 배열). 호출부에서 원 토큰과 합쳐 dedupe.
 */
function englishVariants(token: string): string[] {
  if (/[가-힣]/.test(token) || token.length < 5) return [];
  const out: string[] = [];
  if (token.endsWith('ies') && token.length > 4) out.push(token.slice(0, -3) + 'y'); // libraries→library
  else if (token.endsWith('es') && token.length > 4) out.push(token.slice(0, -2));    // boxes→box
  if (token.endsWith('s') && !token.endsWith('ss') && !token.endsWith('us')) out.push(token.slice(0, -1)); // servers→server
  if (token.endsWith('ing') && token.length > 5) out.push(token.slice(0, -3));        // deploying→deploy
  if (token.endsWith('ed') && token.length > 4) out.push(token.slice(0, -2));         // saved→sav (불완전하나 FTS OR라 무해)
  return out;
}

/**
 * 토큰들을 FTS5 MATCH 쿼리로 조립("token1" OR "token2" ...). 토큰이 없으면 null.
 * memory_search 계열이 raw split 대신 이걸 쓰면 자동주입과 같은 품질을 얻는다.
 *
 * @param expandEnglish 영어 복수/시제 변형도 OR에 포함(명시 검색 recall↑). 자동주입
 *   트리거는 오탐 억제가 중요하니 기본 false, memory_search는 true 권장.
 */
export function buildFtsQuery(tokens: string[], expandEnglish = false): string | null {
  if (tokens.length === 0) return null;
  const terms = new Set<string>();
  for (const t of tokens) {
    terms.add(t);
    if (expandEnglish) for (const v of englishVariants(t)) terms.add(v);
  }
  return [...terms].map(t => `"${t.replace(/"/g, '""')}"`).join(' OR ');
}
