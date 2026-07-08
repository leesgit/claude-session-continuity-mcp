// 연속성 검증용 합성 transcript 데이터셋 생성 (다국어 KR+EN)
// 각 fixture는 Claude Code transcript JSONL 형식을 모사.
import * as fs from 'fs';
import * as path from 'path';

const OUT = process.argv[2];
fs.mkdirSync(OUT, { recursive: true });

// transcript entry 헬퍼
function userMsg(text, opts = {}) {
  return JSON.stringify({
    type: 'user',
    ...(opts.isMeta ? { isMeta: true } : {}),
    timestamp: opts.ts || '2026-07-08T10:00:00.000Z',
    message: { role: 'user', content: opts.array ? [{ type: 'text', text }] : text },
  });
}
function asstMsg(text, ts) {
  return JSON.stringify({
    type: 'assistant',
    timestamp: ts || '2026-07-08T10:01:00.000Z',
    message: { role: 'assistant', content: [{ type: 'text', text }] },
  });
}

const fixtures = {};

// FX1: 슬래시 커맨드 세션 — isMeta 주입 본문 + <command-args> 실제 요청 (한국어)
// 기대: last_work = command-args 내용 (오염 prefix 아님)
fixtures['fx1_slash_command_kr.jsonl'] = [
  userMsg('# /work - 프로젝트 작업 메인 명령어 (v2)\n\n이것은 커맨드 문서 본문입니다. 절대 last_work가 되면 안 됨.', { isMeta: true, array: true, ts: '2026-07-08T10:00:00.000Z' }),
  userMsg('<command-message>work</command-message> <command-name>/work</command-name> <command-args>결제 모듈 버그 수정하고 테스트 추가해줘</command-args>', { ts: '2026-07-08T10:00:05.000Z' }),
  asstMsg('결제 모듈 수정하겠습니다.', '2026-07-08T10:05:00.000Z'),
].join('\n');

// FX2: 영어 슬래시 커맨드 (다국어)
fixtures['fx2_slash_command_en.jsonl'] = [
  userMsg('# /clone - clone a web app\n\nThis is command documentation body. Must NOT become last_work.', { isMeta: true, array: true, ts: '2026-07-08T11:00:00.000Z' }),
  userMsg('<command-args>Fix the checkout flow and add unit tests for the payment service</command-args>', { ts: '2026-07-08T11:00:05.000Z' }),
  asstMsg('I will fix the checkout flow.', '2026-07-08T11:10:00.000Z'),
].join('\n');

// FX3: 영어 에러→해결 페어 (solutions 추출, 다국어)
// error는 한 entry, fix는 다음 assistant entry에 있어야 매칭됨
fixtures['fx3_error_fix_en.jsonl'] = [
  userMsg('the build keeps failing', { ts: '2026-07-08T12:00:00.000Z' }),
  asstMsg('I see the error: TypeError cannot read property map of undefined', '2026-07-08T12:03:00.000Z'),
  asstMsg('Fixed by adding a null guard before the map call in src/list.ts', '2026-07-08T12:05:00.000Z'),
].join('\n');

// FX4: 한국어 실제 에러→해결
fixtures['fx4_error_fix_kr.jsonl'] = [
  userMsg('서버 배포하는데 자꾸 죽어', { ts: '2026-07-08T13:00:00.000Z' }),
  asstMsg('오류: 빌드 실패 메모리 초과입니다', '2026-07-08T13:03:00.000Z'),
  asstMsg('swap 2GB 추가하고 docker 메모리 제한을 4GB로 올려서 해결 완료했습니다', '2026-07-08T13:05:00.000Z'),
].join('\n');

// FX5: 대화 잡음 — '문제'로 오분류되나 뒤에 fix 단어(완료) 있어서 페어 성립.
// 하지만 error_signature가 파편('문제 있으면...')이라 P3 게이트가 거부해야 함.
// npm 버전은 게이트 없어서 이 노이즈를 저장 → 차이 드러남.
fixtures['fx5_noise_not_error.jsonl'] = [
  userMsg('영상 컷 편집 이어서', { ts: '2026-07-08T14:00:00.000Z' }),
  asstMsg('문제 있으면 말씀해 주세요 다음 진행할게요', '2026-07-08T14:03:00.000Z'),
  asstMsg('충돌 물리반응 컷 완성했습니다 렌더링 완료', '2026-07-08T14:05:00.000Z'),
].join('\n');

// FX6: 빈/시스템 세션 (skip 되어야)
fixtures['fx6_empty.jsonl'] = [
  userMsg('[Request interrupted by user]', { ts: '2026-07-08T15:00:00.000Z' }),
].join('\n');

// FX7: duration 뻥튀기 케이스 — first가 며칠 전, last가 오늘 (duration 폐기 테스트)
fixtures['fx7_resume_multiday.jsonl'] = [
  userMsg('리팩토링 계속', { ts: '2026-07-01T09:00:00.000Z' }),  // 7일 전
  asstMsg('이어서 진행합니다.', '2026-07-01T09:10:00.000Z'),
  userMsg('이제 이 부분 마무리해줘', { ts: '2026-07-08T16:00:00.000Z' }), // 오늘
  asstMsg('마무리하겠습니다.', '2026-07-08T16:05:00.000Z'),
].join('\n');

for (const [name, content] of Object.entries(fixtures)) {
  fs.writeFileSync(path.join(OUT, name), content + '\n');
}
console.log('생성된 fixtures:', Object.keys(fixtures).length);
console.log(Object.keys(fixtures).join('\n'));
