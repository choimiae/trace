// Trace 데모 SaaS — 수집기가 무엇을 긁어오는지 한 바퀴에 확인하는 화면.
//
// 의도적으로 이렇게 만든 것들:
//   - 메뉴를 a 가 아니라 span/div 로 둔다. 실제 사내 화면이 이런 모양이고,
//     SDK 가 태그 종류와 무관하게 글자를 걷는지 여기서 드러난다.
//   - 해시를 "#/" 로 시작한다. SDK 는 "#dashboard" 처럼 슬래시 없는 해시를
//     페이지 내 앵커와 구분할 수 없어 화면 이동으로 세지 않는다.
//   - 대시보드를 뷰포트보다 훨씬 길게 만든다. 스크롤이 없으면 마일스톤도 없다.

const CUSTOMERS = [
  { id: 1042, name: "가온소프트", owner: "김서연", plan: "엔터프라이즈", seats: 320, status: "active", updated: "2026-09-18" },
  { id: 1043, name: "미래테크", owner: "이도현", plan: "프로", seats: 84, status: "active", updated: "2026-09-18" },
  { id: 1044, name: "한빛물산", owner: "박준영", plan: "프로", seats: 56, status: "hold", updated: "2026-09-17" },
  { id: 1045, name: "대성이엔지", owner: "최지우", plan: "스탠다드", seats: 22, status: "active", updated: "2026-09-17" },
  { id: 1046, name: "누리컴즈", owner: "정민수", plan: "엔터프라이즈", seats: 410, status: "active", updated: "2026-09-16" },
  { id: 1047, name: "삼정유통", owner: "강하늘", plan: "스탠다드", seats: 14, status: "closed", updated: "2026-09-16" },
  { id: 1048, name: "우성전자", owner: "윤서진", plan: "프로", seats: 96, status: "active", updated: "2026-09-15" },
  { id: 1049, name: "태양건설", owner: "임채원", plan: "엔터프라이즈", seats: 275, status: "hold", updated: "2026-09-15" },
  { id: 1050, name: "케이엠씨", owner: "오세훈", plan: "스탠다드", seats: 31, status: "active", updated: "2026-09-14" },
  { id: 1051, name: "동아플랜트", owner: "한지민", plan: "프로", seats: 67, status: "active", updated: "2026-09-14" },
  { id: 1052, name: "그린바이오", owner: "서준호", plan: "스탠다드", seats: 18, status: "active", updated: "2026-09-12" },
  { id: 1053, name: "신성정밀", owner: "배수현", plan: "프로", seats: 73, status: "hold", updated: "2026-09-12" },
  { id: 1054, name: "제일화학", owner: "노태민", plan: "엔터프라이즈", seats: 512, status: "active", updated: "2026-09-11" },
  { id: 1055, name: "코어링크", owner: "문가영", plan: "스탠다드", seats: 25, status: "closed", updated: "2026-09-11" },
  { id: 1056, name: "청우산업", owner: "조현우", plan: "프로", seats: 88, status: "active", updated: "2026-09-10" },
  { id: 1057, name: "에이스물류", owner: "신보라", plan: "스탠다드", seats: 12, status: "active", updated: "2026-09-10" },
  { id: 1058, name: "광명테크", owner: "유재석", plan: "프로", seats: 104, status: "active", updated: "2026-09-09" },
  { id: 1059, name: "한결에너지", owner: "구본길", plan: "엔터프라이즈", seats: 388, status: "hold", updated: "2026-09-09" },
  { id: 1060, name: "예성소재", owner: "남주혁", plan: "스탠다드", seats: 19, status: "active", updated: "2026-09-08" },
  { id: 1061, name: "포스링크", owner: "허지웅", plan: "프로", seats: 61, status: "active", updated: "2026-09-08" },
];

const STATUS_LABEL = { active: "이용중", hold: "보류", closed: "해지" };

const NAV = [
  { path: "/dashboard", label: "대시보드" },
  { path: "/customers", label: "고객사" },
  { path: "/billing", label: "청구" },
  { path: "/settings", label: "설정" },
];

const LNB = {
  "/dashboard": [
    { path: "/dashboard", label: "실적 요약" },
    { path: "/customers", label: "고객사 목록" },
  ],
  "/customers": [
    { path: "/customers", label: "고객사 목록" },
    { path: "/customers/1042", label: "가온소프트" },
    { path: "/customers/1046", label: "누리컴즈" },
  ],
  "/billing": [
    { path: "/billing", label: "청구 현황" },
    { path: "/settings", label: "청구 설정" },
  ],
  "/settings": [
    { path: "/settings", label: "워크스페이스" },
    { path: "/billing", label: "청구 현황" },
  ],
};

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char],
  );
}

// ── 화면 ────────────────────────────────────────────────

function dashboardView() {
  const kpis = [
    { label: "이번 달 계약", value: "37", delta: "+12%", dir: "up" },
    { label: "활성 고객사", value: "284", delta: "+3%", dir: "up" },
    { label: "해지 요청", value: "6", delta: "+2건", dir: "down" },
    { label: "평균 응답 시간", value: "1.8일", delta: "-0.4일", dir: "up" },
  ];

  const months = [
    { label: "4월", height: 42 },
    { label: "5월", height: 58 },
    { label: "6월", height: 51 },
    { label: "7월", height: 73 },
    { label: "8월", height: 66 },
    { label: "9월", height: 88 },
  ];

  // 스크롤 마일스톤(25·50·75·100%)을 밟으려면 문서가 뷰포트보다 충분히 길어야 한다.
  const logs = Array.from({ length: 28 }, (_, index) => {
    const customer = CUSTOMERS[index % CUSTOMERS.length];
    const hour = String(9 + (index % 9)).padStart(2, "0");
    const minute = String((index * 7) % 60).padStart(2, "0");
    return `
      <div class="log-line">
        <span class="log-time">09-18 ${hour}:${minute}</span>
        <span>${escapeHtml(customer.name)} · ${escapeHtml(customer.owner)} 님이 ${
          index % 3 === 0 ? "견적서를 내려받았습니다" : index % 3 === 1 ? "계약 조건을 수정했습니다" : "문의를 남겼습니다"
        }</span>
      </div>`;
  }).join("");

  return `
    <header>
      <h1>실적 요약</h1>
      <p>영업팀 전체의 이번 분기 진행 상황입니다.</p>
    </header>

    <div class="kpi-grid">
      ${kpis
        .map(
          (kpi) => `
        <div class="kpi-card" data-kpi="${escapeHtml(kpi.label)}">
          <span class="kpi-label">${escapeHtml(kpi.label)}</span>
          <span class="kpi-value">${escapeHtml(kpi.value)}</span>
          <span class="kpi-delta ${kpi.dir}">${escapeHtml(kpi.delta)}</span>
        </div>`,
        )
        .join("")}
    </div>

    <section class="panel">
      <h2>월별 신규 계약</h2>
      <p class="panel-note">막대도 div 다 — 버튼이 아닌 요소의 글자가 걷히는지 같이 본다.</p>
      <div class="bars">
        ${months
          .map(
            (month) => `
          <div class="bar-col">
            <div class="bar" style="height:${month.height}%"></div>
            <span class="bar-label">${escapeHtml(month.label)}</span>
          </div>`,
          )
          .join("")}
      </div>
    </section>

    <section class="panel filler">
      <h2>최근 활동</h2>
      <p class="panel-note">아래로 끝까지 내리면 스크롤 25·50·75·100% 가 한 번씩 기록됩니다.</p>
      ${logs}
    </section>
  `;
}

function customerListView() {
  const rows = CUSTOMERS.map(
    (customer) => `
    <tr data-customer-id="${customer.id}">
      <td>${customer.id}</td>
      <td>${escapeHtml(customer.name)}</td>
      <td>${escapeHtml(customer.owner)}</td>
      <td>${escapeHtml(customer.plan)}</td>
      <td>${customer.seats}</td>
      <td><span class="status ${customer.status}">${STATUS_LABEL[customer.status]}</span></td>
      <td>${customer.updated}</td>
    </tr>`,
  ).join("");

  return `
    <header>
      <h1>고객사</h1>
      <p>행을 누르면 상세로 이동합니다. 경로의 고객사 번호가 <code>:id</code> 로 접히는지 확인하세요.</p>
    </header>

    <section class="panel">
      <div class="table-tools">
        <input class="search" type="text" name="customerSearch" placeholder="고객사명 또는 담당자" />
        <span class="chip" aria-pressed="true">전체</span>
        <span class="chip" aria-pressed="false">이용중</span>
        <span class="chip" aria-pressed="false">보류</span>
        <span class="chip" aria-pressed="false">해지</span>
      </div>

      <table>
        <thead>
          <tr>
            <th>번호</th><th>고객사</th><th>담당자</th><th>요금제</th>
            <th>좌석</th><th>상태</th><th>최근 변경</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>

      <div class="pager">
        <span aria-current="page">1</span><span>2</span><span>3</span><span>4</span>
      </div>
    </section>

    <section class="panel">
      <h2>쿼리는 어떻게 기록되나</h2>
      <p class="panel-note">값은 전부 <code>[redacted]</code> 가 됩니다. 키는 민감한 이름일 때만 가려집니다.</p>
      <ul class="link-list">
        <li><a href="#/customers?page=2&amp;sort=updated">?page=2&amp;sort=updated</a> — 키가 그대로 남습니다</li>
        <li><a href="#/customers?email=seoyeon.kim@example.com&amp;token=sk_live_4eC39H">?email=…&amp;token=…</a> — 키까지 <code>redacted_param_N</code> 이 됩니다</li>
      </ul>
    </section>
  `;
}

function customerDetailView(customerId) {
  const customer = CUSTOMERS.find((item) => String(item.id) === String(customerId)) ?? CUSTOMERS[0];

  return `
    <header>
      <h1>${escapeHtml(customer.name)}</h1>
      <p>경로는 <code>/customers/:id</code> 로 기록되어야 합니다 — 번호가 그대로 남으면 정규화가 안 걸린 것입니다.</p>
    </header>

    <div class="notice">
      아래 값은 전부 가짜입니다. 세션 리플레이를 켠 채로 이 화면을 지나가면,
      README 의 「세션 리플레이가 가리지 못하는 것」 표가 실제로 어떻게 나타나는지 볼 수 있습니다.
    </div>

    <section class="panel">
      <h2>기본 정보</h2>
      <dl class="detail-grid">
        <div>
          <dt>담당자</dt>
          <dd title="${escapeHtml(customer.owner)}" data-owner-name="${escapeHtml(customer.owner)}">
            ${escapeHtml(customer.owner)}
          </dd>
        </div>
        <div>
          <dt>이메일</dt>
          <dd>${escapeHtml(customer.owner)}@example.com</dd>
        </div>
        <div>
          <dt>휴대폰</dt>
          <dd><a href="tel:010-2345-6789">010-2345-6789</a></dd>
        </div>
        <div>
          <dt>대표번호</dt>
          <dd>1588-1234</dd>
        </div>
        <div>
          <dt>사업자번호</dt>
          <dd>220-81-62517</dd>
        </div>
        <div>
          <dt>요금제</dt>
          <dd>${escapeHtml(customer.plan)} · ${customer.seats}석</dd>
        </div>
      </dl>
    </section>

    <section class="panel">
      <h2>계약 이력</h2>
      <table>
        <thead><tr><th>일자</th><th>구분</th><th>금액</th><th>처리자</th></tr></thead>
        <tbody>
          <tr><td>2026-09-18</td><td>좌석 추가</td><td>4,200,000원</td><td>${escapeHtml(customer.owner)}</td></tr>
          <tr><td>2026-06-30</td><td>연간 갱신</td><td>38,400,000원</td><td>${escapeHtml(customer.owner)}</td></tr>
          <tr><td>2026-03-12</td><td>신규 계약</td><td>31,000,000원</td><td>김서연</td></tr>
        </tbody>
      </table>
    </section>
  `;
}

function settingsView() {
  return `
    <header>
      <h1>워크스페이스 설정</h1>
      <p>입력한 값은 수집되지 않습니다. 필드를 채워 본 뒤 대시보드에서 확인하세요.</p>
    </header>

    <section class="panel">
      <h2>기본 정보</h2>
      <form id="settings-form">
        <div class="field">
          <label for="workspaceName">워크스페이스 이름</label>
          <input type="text" name="workspaceName" id="workspaceName" value="더존비즈온 영업팀" />
        </div>
        <div class="field">
          <label for="ownerEmail">관리자 이메일</label>
          <input type="email" name="ownerEmail" id="ownerEmail" value="choi@example.com" />
        </div>
        <div class="field">
          <label for="apiKey">API 키</label>
          <input type="password" name="apiKey" id="apiKey" value="sk_live_4eC39HqLyjWDarjtT1zdp7dc" />
        </div>
        <div class="field">
          <label for="approver">담당 승인자</label>
          <select name="approver" id="approver">
            <option value="">선택하세요</option>
            <option value="kim">김서연</option>
            <option value="lee">이도현</option>
            <option value="park">박준영</option>
          </select>
        </div>
        <div class="field">
          <label for="memo">메모</label>
          <textarea name="memo" id="memo">김서연 담당자 연락처 010-1234-5678</textarea>
        </div>

        <div class="field">
          <label>알림 주기</label>
          <div class="choices">
            <label><input type="radio" name="digest" value="daily" checked /> 매일</label>
            <label><input type="radio" name="digest" value="weekly" /> 매주</label>
            <label><input type="radio" name="digest" value="never" /> 받지 않음</label>
          </div>
        </div>

        <div class="field">
          <label>수신 항목</label>
          <div class="choices">
            <label><input type="checkbox" name="topic" value="contract" checked /> 계약 변경</label>
            <label><input type="checkbox" name="topic" value="billing" /> 청구 오류</label>
            <label><input type="checkbox" name="topic" value="churn" checked /> 해지 신호</label>
          </div>
        </div>

        <div class="form-actions">
          <button type="submit" class="primary">저장</button>
          <button type="button">되돌리기</button>
        </div>
      </form>
    </section>
  `;
}

function billingView() {
  return `
    <header>
      <h1>청구 현황</h1>
      <p>여기는 의도적으로 막히게 만든 구역입니다. 각 버튼이 무엇을 남겨야 하는지 옆에 적어 뒀습니다.</p>
    </header>

    <div class="notice">
      <strong>버튼 사이에 2초씩 쉬어 주세요.</strong> 반응 없는 클릭은 "누른 뒤 2초 안에 아무 일도 없었다" 로
      판정합니다. 곧바로 다른 버튼을 누르면 그 클릭이 반응으로 잡혀 앞 버튼이 정상으로 기록됩니다.
    </div>

    <section class="panel">
      <h2>마찰 구역</h2>
      <div class="friction">
        <div class="friction-row">
          <button id="dead-click">권한 추가</button>
          <span class="expect">
            아무 일도 일어나지 않습니다 → <strong>반응 없는 클릭</strong>
            (<code>dead_click_cluster</code>) 이 뜨면 정상입니다.
          </span>
        </div>

        <div class="friction-row">
          <button id="rage-click">결제 재시도</button>
          <span class="expect">
            <strong>3초 안에 세 번 이상</strong> 누르세요 → <strong>분노 클릭</strong>
            (<code>rage_click</code>). 역시 아무 반응도 하지 않습니다.
          </span>
        </div>

        <div class="friction-row">
          <button id="js-error">명세서 다시 계산</button>
          <span class="expect">
            JS 오류를 냅니다 → <code>js_error</code> 이벤트와 <strong>오류 마찰</strong>
            (<code>error_friction</code>).
          </span>
        </div>

        <div class="friction-row">
          <button id="custom-event" class="primary">명세서 내보내기</button>
          <span class="expect">
            <code>track("invoice_exported")</code> 를 부릅니다 → <code>custom_event</code>.
            반응이 있으니 반응 없는 클릭으로는 잡히지 않아야 합니다.
          </span>
        </div>

        <div class="friction-row">
          <button id="push-route">경로 라우팅으로 이동</button>
          <span class="expect">
            해시가 아니라 <code>history.pushState</code> 로 <code>/invoices/2026-09</code> 로 옮깁니다 →
            해시 없이도 <code>page_view</code> 가 잡히는지 확인합니다.
          </span>
        </div>
      </div>
    </section>

    <section class="panel">
      <h2>이번 달 청구서</h2>
      <table>
        <thead><tr><th>고객사</th><th>금액</th><th>상태</th><th>발행일</th></tr></thead>
        <tbody>
          ${CUSTOMERS.slice(0, 6)
            .map(
              (customer) => `
            <tr data-customer-id="${customer.id}">
              <td>${escapeHtml(customer.name)}</td>
              <td>${(customer.seats * 120000).toLocaleString("ko-KR")}원</td>
              <td><span class="status ${customer.status}">${STATUS_LABEL[customer.status]}</span></td>
              <td>2026-09-01</td>
            </tr>`,
            )
            .join("")}
        </tbody>
      </table>
    </section>
  `;
}

// ── 라우터 ──────────────────────────────────────────────

function currentPath() {
  const hash = window.location.hash;
  if (hash.startsWith("#/")) return hash.slice(1).split("?")[0];
  // pushState 로 옮겨온 경우 해시가 없다.
  if (window.location.pathname !== "/") return window.location.pathname;
  return "/dashboard";
}

function viewFor(path) {
  const detail = path.match(/^\/customers\/([^/]+)$/);
  if (detail) return customerDetailView(detail[1]);
  if (path.startsWith("/customers")) return customerListView();
  if (path.startsWith("/settings")) return settingsView();
  if (path.startsWith("/billing")) return billingView();
  if (path.startsWith("/invoices")) return billingView();
  return dashboardView();
}

function navKeyFor(path) {
  if (path.startsWith("/customers")) return "/customers";
  if (path.startsWith("/settings")) return "/settings";
  if (path.startsWith("/billing") || path.startsWith("/invoices")) return "/billing";
  return "/dashboard";
}

function renderChrome(path) {
  const navKey = navKeyFor(path);

  document.getElementById("gnb").innerHTML = NAV.map(
    (item) =>
      `<span class="gnb-item" data-path="${item.path}"${
        item.path === navKey ? ' aria-current="page"' : ""
      }>${item.label}</span>`,
  ).join("");

  document.getElementById("lnb-items").innerHTML = (LNB[navKey] ?? [])
    .map(
      (item) =>
        `<div class="lnb-item" data-path="${item.path}"${
          item.path === path ? ' aria-current="page"' : ""
        }>${item.label}</div>`,
    )
    .join("");
}

function go(path) {
  window.location.hash = `#${path}`;
}

function render() {
  const path = currentPath();
  renderChrome(path);
  document.getElementById("view").innerHTML = viewFor(path);
  window.scrollTo(0, 0);
  bindViewHandlers();
}

// ── 화면 안의 동작 ──────────────────────────────────────

function bindViewHandlers() {
  document.querySelectorAll("tbody tr[data-customer-id]").forEach((row) => {
    row.addEventListener("click", () => go(`/customers/${row.dataset.customerId}`));
  });

  document.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      document.querySelectorAll(".chip").forEach((other) => other.setAttribute("aria-pressed", "false"));
      chip.setAttribute("aria-pressed", "true");
    });
  });

  document.querySelectorAll(".pager span").forEach((page) => {
    page.addEventListener("click", () => {
      document.querySelectorAll(".pager span").forEach((other) => other.removeAttribute("aria-current"));
      page.setAttribute("aria-current", "page");
    });
  });

  const settingsForm = document.getElementById("settings-form");
  if (settingsForm) {
    settingsForm.addEventListener("submit", (event) => {
      event.preventDefault();
      window.trace?.track("workspace_settings_saved");
    });
  }

  // 마찰 버튼 — 반응 없는 두 개는 정말로 아무것도 하지 않아야 한다.
  // 로그 한 줄이라도 DOM 을 건드리면 클릭이 반응한 것으로 잡힌다.
  document.getElementById("js-error")?.addEventListener("click", () => {
    throw new Error("Demo billing recalculation failed");
  });

  document.getElementById("custom-event")?.addEventListener("click", () => {
    window.trace?.track("invoice_exported", { period: "2026-09" });
  });

  document.getElementById("push-route")?.addEventListener("click", () => {
    window.history.pushState({}, "", "/invoices/2026-09");
    renderChrome("/invoices");
    document.getElementById("view").innerHTML = viewFor("/invoices");
    bindViewHandlers();
  });
}

// 껍데기(GNB·LNB)는 한 번만 묶는다. 화면마다 다시 그려도 위임으로 잡힌다.
document.addEventListener("click", (event) => {
  const target = event.target.closest("[data-path]");
  if (target) go(target.dataset.path);
});

window.addEventListener("hashchange", render);
window.addEventListener("popstate", render);

if (!window.location.hash.startsWith("#/")) {
  window.location.replace(`${window.location.pathname}${window.location.search}#/dashboard`);
} else {
  render();
}
