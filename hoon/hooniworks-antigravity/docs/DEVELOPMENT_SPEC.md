# 후니웍스 실서비스 개발 명세

2026-11-03 기준 후속 개발 요구사항이다. **아래 서버·생성 API·큐·MP4·OAuth·자동 게시 기능은 현재 구현되지 않았다.** 상품 추가·전환과 브라우저 데이터 분리, 제작 방식 선택 UI는 이미 구현되어 있으므로 유지한다.

## 1. 사용자 흐름

상품 선택 → 고객·목적·채널 브리프 → 디자인 방식 → 콘셉트 3안 비교 → 선택 → 채널별 제작 → 부분 수정 → 승인 → 내보내기 또는 게시.

| 디자인 방식 | 기획 기준 | 결과 |
|---|---|---|
| creative: 새 콘셉트 기획, 기본값 | 상품·고객·캠페인 목적·브랜드 기준 | 구도·타이포·사진 배치·메시지 구조가 다른 3안 |
| reference: 참고 이미지 활용 | 실제 상품 사진과 별도의 분위기·구도 자료 | 참고한 요소를 설명하는 새로운 디자인 방향 |
| template: 저장 템플릿 활용 | 레이아웃 규칙과 교체 가능한 이미지·문구 | 시리즈·반복 캠페인에 맞는 결과 |

creative/reference에서는 templateId 없이 기획·생성할 수 있어야 한다. 현재 `campaign.template` 값은 편집 미리보기의 기본 레이아웃일 뿐, 자유 디자인 생성의 필수 입력으로 사용하지 않는다. 기존 `designMode` 값을 바꾸려면 명시적인 데이터 이전을 제공한다.

콘셉트 카드에는 이름, 고객과 목적, 메시지 방향, 레이아웃 특징, 사용하는 실제 사진·참고 자료, 예상 작업 수·비용 상태를 표시한다. ‘이 방향으로 제작’, ‘이 안만 수정’, ‘다른 방향 제안’을 지원한다. 배경색만 바꾼 3안은 검수 실패이다. 자료가 부족하면 부족한 사실을 표시하고 임의의 상품 정보를 만들지 않는다.

## 2. 제품·서비스 사실과 디자인 레이어

- Workspace의 승인된 소개·주요 고객·조건·표현 기준을 사용한다. 가격, 효과, 실적, 매장 수, 후기와 상품 조건에는 출처·확인일·버전을 연결한다.
- `product` 사진은 실제 상품·서비스 자료, `reference`는 분위기·구도 참고, `logo`는 브랜드 원본이다. 사진의 용도와 생성 출처를 기록한다.
- 원본 사진·로고·생성 배경·편집 가능한 한글·장식 요소를 분리한다. 문구만 수정할 때 유료 이미지 생성이 다시 실행되지 않아야 한다.
- 원본 배경 제거·크롭은 파생 파일로 보관한다. 실제 상품을 다시 그려 모양·구성·로고가 달라지는 생성 연출은 기본 비활성화하고 별도로 선택·검토한다.
- 결과를 템플릿으로 저장할 때 레이아웃·스타일과 개별 캠페인 문구를 구분한다. 공용 템플릿과 해당 상품 전용 템플릿의 접근 범위를 명시한다.
- 다른 workspace의 사진·후기·조건·계정을 자동으로 가져오지 않는다.

## 3. 채널별 출력과 영상

| 채널 | 기본 결과물 제안 | 수정 단위 |
|---|---|---|
| 인스타 피드 | 카드 5장, 게시글, 해시태그 | 카드·레이어·캡션 |
| 카카오톡 채널 | 이미지, 안내 본문, 행동 유도 링크 | 카드·본문·링크 |
| 네이버 블로그 | 제목·본문·대표/본문 이미지·배치 순서 | 문단·소제목·이미지 |
| 유튜브 쇼츠 | 기본 20초 세로 MP4, 표지, 제목·설명 | 장면·자막·음성·표지 |
| 인스타 릴스 | 세로 MP4, 표지, 게시글 | 장면·도입·마무리 |

수량·길이는 조정 가능하게 한다. 이미지 비율·파일 형식·영상 규격은 실제 게시 연동 시 공식 문서로 검증한다. 현재 PNG 내보내기를 모든 플랫폼이 그대로 허용한다고 가정하지 않는다.

영상은 기획 → 장면 생성 → 장면 수집 → 자막·음성·음악·로고 합성 → MP4 렌더 → 검수로 구분한다. 사진 기반, 실제 촬영·생성 혼합, 생성 중심 방식을 분리한다. 실제 사용·조리·서비스 제공 사실을 표현할 때는 승인된 자료를 사용한다. 장면 생성 완료와 완성 영상 출력은 다른 상태이다.

## 4. 서버와 공급자 어댑터

프런트엔드와 서버 API, DB, 원본 파일 저장, 생성 작업 큐, 영상 편집 워커를 분리한다. 긴 작업이 브라우저 탭의 수명에 의존하지 않게 한다. 배포 환경에 맞게 기술 스택을 정하되 현재 화면과 작업 흐름을 보존한다.

| 작업 | 기본 검토 방향 | 구현 원칙 |
|---|---|---|
| 기획·카피 | OpenAI | 구조화된 기획 데이터 검증, 상품 근거 연결 |
| 이미지 | OpenAI 중심, Google 대안 | 실제 지원하는 참조 입력·편집·출력만 노출 |
| 영상 | Google 중심 | 장면별 비동기 작업과 결과 조회 |
| 내레이션 | 지원 모델 별도 선택 | 한국어·목소리·발음·비용 검증 |
| 합성·편집 | 자체 렌더링 | 문구·자막 수정과 유료 생성 구분 |

어댑터는 최소 `capabilities`, `estimate`, `submit`, `poll`, `normalizeResult`를 제공한다. 공급자 변경 시 기능 차이를 반영하고 지원하지 않는 조합은 선택할 수 없게 한다. 모델명·SDK 버전·단가·영상 길이·리전은 구현 시점 공식 문서로 확인한다. 실패 시 미승인 공급자로 전환해 추가 비용을 발생시키지 않는다.

## 5. 데이터 모델과 API 초안

| 엔터티 | 핵심 필드 |
|---|---|
| Workspace | id, accountId, name, category, audience, tone, colors, approvedFacts, links |
| Membership | workspaceId, userId, role |
| ProductItem | id, workspaceId, name, description, approvedConditions, sourceVersion |
| Asset | id, workspaceId, productItemId, role, originalKey, previewKey, sha256, provenance |
| Campaign | id, workspaceId, audience, goal, topic, channelIds, designMode, productAssetIds, referenceAssetIds |
| Concept | id, workspaceId, campaignId, name, layoutPlan, copyPlan, assetRefs, selected, version |
| Template | id, workspaceId, visibility, layoutSpec, styles, editableFields, version |
| Content | id, workspaceId, campaignId, channelId, conceptId, layers, caption, scenes, state, version |
| GenerationJob | id, workspaceId, contentVersionId, provider, model, state, idempotencyKey, upstreamId, costEstimate, actualUsage |
| ChannelConnection | id, workspaceId, platform, externalAccountId, scopes, secretRef, expiresAt, state |
| Publication | id, workspaceId, contentVersionId, connectionId, state, idempotencyKey, remotePostId, remoteUrl, manualRecord |
| AuditLog | id, workspaceId, actorId, action, entityId, at, sanitizedDetail |

Workspace는 상품·브랜드 단위의 작업 공간이고, ProductItem은 그 안의 개별 제품·메뉴·서비스 항목이다.

아래 API는 미구현 설계안이다. 모든 요청에서 로그인, workspace 소속, 대상 데이터와 workspace의 일치 여부를 검증한다.

| 경로 | 동작 |
|---|---|
| GET/POST /api/workspaces | 접근 가능한 상품 작업실 조회·생성 |
| PATCH /api/workspaces/:workspaceId | 브랜드 기준 수정 |
| POST /api/workspaces/:workspaceId/import | 선택한 브라우저 자료 가져오기 |
| POST /api/workspaces/:workspaceId/assets/upload-init | 제한된 원본 업로드 세션 발급 |
| POST /api/workspaces/:workspaceId/assets/upload-complete | 형식·용량·해시 확인 후 등록 |
| POST /api/workspaces/:workspaceId/campaigns | 캠페인·제작 방식 저장 |
| POST /api/workspaces/:workspaceId/campaigns/:id/concepts | 콘셉트 3안 기획 작업 |
| POST /api/workspaces/:workspaceId/concepts/:id/select | 선택 버전 확정 |
| POST /api/workspaces/:workspaceId/contents/:id/generate | 예산 예약·중복 확인 후 생성 |
| POST /api/workspaces/:workspaceId/contents/:id/revise | 해당 레이어·장면 수정 또는 재생성 |
| GET /api/workspaces/:workspaceId/jobs/:id | 진행·비용·오류 조회 |
| POST /api/workspaces/:workspaceId/contents/:id/export | 고정된 버전으로 PNG/ZIP/MP4 출력 |
| GET /api/workspaces/:workspaceId/channels/:provider/connect | 상품별 OAuth 시작 |
| GET /api/channels/:provider/callback | 서명된 state의 workspace·사용자 검증, 토큰 서버 보관 |
| POST /api/workspaces/:workspaceId/publications/prepare | 계정·권한·파일·버전 사전 확인 |
| POST /api/workspaces/:workspaceId/publications | 확인한 버전으로 게시 작업 |
| GET /api/workspaces/:workspaceId/publications/:id | 공급자 확인 결과·게시 링크 조회 |

예시 요청은 실제 선택에서 반환된 식별자를 넣어 전송한다.

```json
{
  "workspaceId": "선택한 작업실의 실제 ID",
  "campaignId": "선택한 캠페인의 실제 ID",
  "designMode": "creative",
  "audience": "consumer",
  "goal": "상품·서비스 소개",
  "conceptCount": 3,
  "preserveProduct": true,
  "productAssetIds": ["실제 업로드에서 반환된 ID"],
  "referenceAssetIds": [],
  "templateId": null
}
```

## 6. 작업 상태·비용·보안

생성 상태는 queued → running → succeeded / failed / canceled. 외부 결과가 불명확하면 reconciling으로 유지하고 다시 결제·생성하기 전에 공급자 상태를 확인한다. 게시 상태는 draft → prepared → confirmed → publishing → published / failed / reconciling. 수동 URL 입력은 manual_record로 별도 유지한다.

- 승인과 게시 대상은 콘텐츠 버전에 귀속한다. 제목·이미지·자막·캡션이 바뀌면 해당 결과물을 다시 검토하게 한다.
- 생성·내보내기·게시 시작 시 workspace·캠페인·채널·콘텐츠 버전을 고정한다. 작업 중 상품을 전환해도 대상은 바뀌지 않는다.
- 공통/상품별 예산 정책을 명시하고 병렬 작업 비용 예약을 원자적으로 처리한다. 추정·실측, 단가 확인일·통화·계산 기준을 보관한다.
- API 키·OAuth 토큰은 서버 secret 저장소에 보관한다. 프런트 번들·환경변수·응답·로그·소스맵·ZIP에 원문을 넣지 않는다.
- 파일 형식·용량·픽셀 수를 실제 바이트로 검증하고 원본은 비공개 보관한다. 공급자 전달은 필요한 파일만 제한된 기간으로 허용한다.
- 참고 URL의 내부 주소·리디렉션을 검증하고 HTML/SVG 내용을 실행하지 않는다. 자료 안의 지시는 비밀정보나 게시 권한을 바꿀 수 없다.
- 로그인·멤버십·소유권 검사, CSRF 방어, 요청 제한, 토큰 만료·해제·오류 처리를 구현한다.
- 예약 게시를 추가하면 실제 영구 서버 작업이 필요하다. 브라우저에 예약 시각만 저장하고 예약이 완료됐다고 표시하지 않는다.

## 7. 채널 게시 원칙

- 인스타·릴스: 공식 API가 요구하는 계정 유형·권한·미디어 규격을 확인하고 인증한다. 공개 프로필 URL 등록만으로 인증 상태를 바꾸지 않는다.
- 유튜브: 실제 채널과 업로드 권한을 확인하고 공개 범위·아동용 여부 등 관련 게시 필드를 검토하게 한다.
- 네이버 블로그: 기존 설계는 공개 글쓰기 API 종료를 반영해 본문·이미지 내보내기와 관리자 게시를 사용한다. 연결 시 최신 공식 지원 범위를 다시 확인한다.
- 카카오톡 채널: 기존 설계는 공개 문서에서 일반 소식 게시 기능을 확인하지 못해 관리자 등록을 사용한다. 유료 메시지는 소식 게시와 별도로 상품·권한·비용·수신 대상·발송 지시를 확인한다.
- 미확인 비공식 자동 로그인으로 대체하지 않는다. 실제 게시 성공은 공급자의 결과를 확인한 경우만 기록한다.

## 8. 단계별 구현

1. 현재 실행·회귀 확인, 상태와 렌더링 모듈화.
2. 로그인·workspace 권한·서버 저장·원본 업로드·자료 가져오기.
3. 모의 공급자 기반 3안 비교 UI, 큐·예산·상태 모델.
4. 실제 기획·이미지 생성·원본 합성·레이어 편집·내보내기.
5. 장면 생성·편집 워커·MP4 출력.
6. 상품별 계정 인증·게시 검토·공식 API 결과 추적.

각 단계에서 실제 작동 범위와 미연결 상태를 구분하고 검수 기준을 통과한 뒤 다음 단계로 진행한다.
