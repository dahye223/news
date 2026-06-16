# 경기도의회 의원활동 언론보도 리포트

경기도의회 보도자료(`ggc.go.kr`)에서 **오늘자** 의원 보도자료를 수집하고, 의원명으로 네이버 뉴스를 검색해 외부 언론 기사를 매칭한 뒤 상임위별로 묶어 리포트(`report_YYYY-MM-DD.txt`/`.json`)를 만든다.

## GitHub Actions

`.github/workflows/ggc-press-report.yml`

- **수동 실행**: Actions 탭 → `GGC Press Report` → `Run workflow` (날짜·정당 필터 입력 가능)
- **자동 실행**: 매일 17:00 KST(08:00 UTC) 스케줄
- 결과는 `reports/`에 커밋되고, 동일 파일이 artifact(`ggc-press-report`, 30일 보관)로도 업로드된다.

### 카카오톡 전송은 포함되지 않음

카카오톡 '나에게 보내기'는 **로컬 MCP 전용**이라 클라우드(Actions)에서 호출할 수 없다. 따라서 이 워크플로는 **리포트 생성/저장까지만** 수행한다. 카톡 전송이 필요하면 로컬 PC에서 `ggc-press-report` 스킬로 전송하거나, 별도로 카카오 REST API 연동을 추가해야 한다.

## 로컬 실행

```bash
# 기본: 오늘 / 전체 의원
GGC_OUT="$(pwd)/reports" node build_report.js

# 특정 날짜 / 특정 정당
GGC_OUT="$(pwd)/reports" node build_report.js 2026-06-16 더불어민주당
```

인자: 1) 날짜 `YYYY-MM-DD`(생략 시 오늘) 2) 정당(생략 시 전체). 의존성 없는 Node 18+ 스크립트.
