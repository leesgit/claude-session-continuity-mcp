// 텍스트 응답 헬퍼 함수
export function textResult(text, isError) {
    return {
        content: [{ type: 'text', text }],
        isError
    };
}
