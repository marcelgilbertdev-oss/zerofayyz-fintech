import type { Locale } from "./locale";

/**
 * The English dictionary is the shape; every other locale must satisfy it, so a
 * missing Japanese string is a compile error rather than an English word
 * appearing unannounced in a Japanese page.
 */
const en = {
  meta: {
    title: "ZEROFAYYZ FINTECH | Cloud Payments & Operations",
    description:
      "A sandbox fintech portfolio platform demonstrating payment operations, transaction monitoring, and cloud-ready engineering.",
  },
  brand: { name: "ZEROFAYYZ", suffix: "FINTECH" },
  sandbox: {
    label: "Sandbox",
    badge: "Test mode",
    note: "Simulated portfolio environment",
  },
  nav: {
    primaryLabel: "Primary navigation",
    projectLabel: "Project navigation",
    overview: "Overview",
    payments: "Payments",
    transactions: "Transactions",
    customers: "Customers",
    admin: "Admin console",
    systemHealth: "System health",
    auditLog: "Audit log",
    portfolioNotes: "Portfolio notes",
    planned: "Planned",
    plannedTitle: "Planned — see the roadmap in the README",
  },
  build: { label: "Portfolio build", stage: "MVP foundation", phase: "Phase 1" },
  header: {
    overview: "Operations overview",
    apiConnected: "API connected",
    apiUnavailable: "API unavailable",
    testPayment: "+ Test payment",
    openingStripe: "Opening Stripe…",
    languageLabel: "Language",
    switchToJapanese: "日本語",
    switchToEnglish: "English",
  },
  hero: {
    eyebrow: "Payment operations",
    morning: "Good morning, Marcel.",
    afternoon: "Good afternoon, Marcel.",
    evening: "Good evening, Marcel.",
    blurb:
      "Monitor the sandbox payment lifecycle, review recent activity, and verify platform health from one workspace.",
    live: "Live sandbox data",
    unavailable: "Metrics unavailable",
    updated: "Updated just now",
  },
  banner: {
    success:
      "Stripe sandbox checkout completed. The signed webhook is updating the PostgreSQL ledger.",
    canceled: "Stripe sandbox checkout was canceled. No funds moved.",
  },
  metrics: {
    sectionLabel: "Key metrics",
    grossVolume: "Gross volume",
    succeededPayments: "Successful payments",
    pendingSettlement: "Pending settlement",
    webhookEvents: "Webhook events",
    succeededNote: (count: string) => `${count} succeeded`,
    successRate: (rate: string) => `${rate}% success rate`,
    noSettled: "No settled payments yet",
    processingNote: (count: string) => `${count} processing`,
    deduplicated: "Deduplicated by Stripe event id",
  },
  chart: {
    title: "Payment volume",
    settled: "settled",
    window: (days: string) => `Last ${days} days`,
    unavailable: "Volume history unavailable.",
  },
  health: {
    title: "System health",
    subtitle: "Real integration status",
    liveCount: (live: string, total: string) => `${live} of ${total} live`,
    apiService: "API service",
    database: "PostgreSQL",
    stripe: "Stripe sandbox",
    webhook: "Webhook queue",
    operational: "Operational",
    unavailable: "Unavailable",
    configured: "Configured",
    notConnected: "Not connected",
    connected: "Connected",
    testApiAccess: "Test API access",
    awaitingKey: "Awaiting test key",
    signatureVerification: "Signature verification",
    awaitingSecret: "Awaiting signing secret",
    responseSource: "API response source",
    liveEndpoint: "Live endpoint",
    fallbackState: "Fallback state",
  },
  transactions: {
    title: "Recent transactions",
    live: "Live sandbox records from PostgreSQL",
    unavailableSource: "Transaction service unavailable",
    showing: "Showing the 10 most recent",
    customer: "Customer",
    amount: "Amount",
    method: "Payment method",
    status: "Status",
    time: "Time",
    empty: "Transaction data is currently unavailable.",
    stripeCheckout: "Stripe Checkout",
    sandboxCard: "Sandbox card",
  },
  status: {
    succeeded: "Succeeded",
    processing: "Processing",
    failed: "Failed",
    canceled: "Canceled",
    created: "Created",
    refunded: "Refunded",
  },
  flow: {
    label: "MVP payment flow",
    blurb: "A visible, testable path from checkout to financial record.",
    steps: ["Next.js app", "Backend API", "Stripe sandbox", "Webhook event", "PostgreSQL"],
  },
  footer: {
    left: "ZEROFAYYZ FINTECH · Portfolio Prototype",
    right: "Sandbox data only · No real funds processed",
  },
  checkout: {
    error: "Unable to start checkout",
    unavailable: "The payment API is currently unavailable",
    amountLabel: "Test payment amount in US dollars",
    amountHint: "Any amount from $0.50 to $10,000.00",
    amountInvalid: "Enter an amount between $0.50 and $10,000.00",
  },
  auth: {
    signIn: "Sign in",
    signOut: "Sign out",
    adminConsole: "Admin console",
    loginTitle: "Admin console sign-in",
    loginSubtitle:
      "The dashboard is public. This door is for the operational half: the audit trail, live sessions, and account management.",
    emailLabel: "Email address",
    passwordLabel: "Password",
    submitting: "Signing in…",
    genericError: "Unable to sign in",
    demoTitle: "Reviewer access",
    demoIntro:
      "Use the demo operator account — it is published on purpose, so you can walk in without asking anyone:",
    demoNote:
      "The operator role can read everything and change nothing. Administration is reserved for the platform owner.",
    demoFill: "Fill these in for me",
    demoFilled: "Filled in — press Sign in",
    signedInAs: (name: string) => `Signed in as ${name}`,
  },
  admin: {
    title: "Admin console",
    subtitle:
      "The privileged half of the platform. Every request on this page is re-checked on the server — hiding a panel is presentation, the API guard is the boundary.",
    roleLabel: "Role",
    presenceTitle: "Active sessions",
    presenceSubtitle: "Everyone signed in right now, straight from the session store.",
    presenceYou: "This is you",
    presenceRevoke: "Sign out this session",
    presenceRevoking: "Signing out…",
    presenceEmpty: "No one is signed in.",
    presenceColumns: {
      who: "Who",
      role: "Role",
      signedIn: "Signed in",
      lastSeen: "Last seen",
      actions: "Actions",
    },
    auditTitle: "Audit log",
    auditSubtitle:
      "Append-only history — the database refuses edits and deletions, so what happened stays written.",
    auditEmpty: "Nothing recorded yet.",
    auditColumns: {
      when: "When",
      action: "Action",
      actor: "Actor",
      entity: "Entity",
    },
    auditSystem: "system",
    usersTitle: "Accounts",
    usersSubtitle: "Staff and sandbox customers, with how many payments each customer has made.",
    usersColumns: {
      who: "Who",
      role: "Role",
      payments: "Payments",
      lastLogin: "Last login",
    },
    usersNever: "Never",
    operatorNotice:
      "You are signed in as an operator: the audit log is readable, but session and account management are reserved for administrators.",
    loadError: "This panel could not be loaded from the API.",
  },
};

// Deliberately not `as const`: the English dictionary defines the *shape*, not
// the permitted words. With literal types every Japanese string would fail to
// assign. Structure is enforced; wording is free.
type Dictionary = typeof en;

const ja: Dictionary = {
  meta: {
    title: "ZEROFAYYZ FINTECH | クラウド決済・オペレーション",
    description:
      "決済オペレーション、取引モニタリング、クラウド対応のエンジニアリングを実証するサンドボックス型フィンテック・ポートフォリオ基盤。",
  },
  brand: { name: "ZEROFAYYZ", suffix: "FINTECH" },
  sandbox: {
    label: "サンドボックス",
    badge: "テストモード",
    note: "シミュレーション環境",
  },
  nav: {
    primaryLabel: "メインナビゲーション",
    projectLabel: "プロジェクトナビゲーション",
    overview: "概要",
    payments: "決済",
    transactions: "取引",
    customers: "顧客",
    admin: "管理コンソール",
    systemHealth: "システム稼働状況",
    auditLog: "監査ログ",
    portfolioNotes: "ポートフォリオ・ノート",
    planned: "予定",
    plannedTitle: "予定 — README のロードマップを参照",
  },
  build: { label: "ポートフォリオ構築", stage: "MVP 基盤", phase: "フェーズ 1" },
  header: {
    overview: "オペレーション概要",
    apiConnected: "API 接続済み",
    apiUnavailable: "API 利用不可",
    testPayment: "＋ テスト決済",
    openingStripe: "Stripe を開いています…",
    languageLabel: "言語",
    switchToJapanese: "日本語",
    switchToEnglish: "English",
  },
  hero: {
    eyebrow: "決済オペレーション",
    morning: "おはようございます、Marcel さん。",
    afternoon: "こんにちは、Marcel さん。",
    evening: "こんばんは、Marcel さん。",
    blurb:
      "サンドボックスの決済ライフサイクルを監視し、最近のアクティビティを確認し、プラットフォームの稼働状況を一つの画面で検証します。",
    live: "ライブ・サンドボックスデータ",
    unavailable: "指標を取得できません",
    updated: "たった今更新",
  },
  banner: {
    success:
      "Stripe サンドボックス決済が完了しました。署名付き Webhook が PostgreSQL 台帳を更新しています。",
    canceled: "Stripe サンドボックス決済はキャンセルされました。資金の移動はありません。",
  },
  metrics: {
    sectionLabel: "主要指標",
    grossVolume: "総取引額",
    succeededPayments: "成功した決済",
    pendingSettlement: "決済処理中",
    webhookEvents: "Webhook イベント",
    succeededNote: (count: string) => `成功 ${count} 件`,
    successRate: (rate: string) => `成功率 ${rate}%`,
    noSettled: "確定した決済はまだありません",
    processingNote: (count: string) => `処理中 ${count} 件`,
    deduplicated: "Stripe イベント ID で重複排除",
  },
  chart: {
    title: "決済額の推移",
    settled: "確定",
    window: (days: string) => `直近 ${days} 日間`,
    unavailable: "取引額の履歴を取得できません。",
  },
  health: {
    title: "システム稼働状況",
    subtitle: "実際の連携ステータス",
    liveCount: (live: string, total: string) => `${total} 件中 ${live} 件稼働`,
    apiService: "API サービス",
    database: "PostgreSQL",
    stripe: "Stripe サンドボックス",
    webhook: "Webhook キュー",
    operational: "正常稼働",
    unavailable: "利用不可",
    configured: "設定済み",
    notConnected: "未接続",
    connected: "接続済み",
    testApiAccess: "テスト API アクセス",
    awaitingKey: "テストキー待ち",
    signatureVerification: "署名検証",
    awaitingSecret: "署名シークレット待ち",
    responseSource: "API レスポンス元",
    liveEndpoint: "ライブエンドポイント",
    fallbackState: "フォールバック状態",
  },
  transactions: {
    title: "最近の取引",
    live: "PostgreSQL のライブ・サンドボックス記録",
    unavailableSource: "取引サービスを利用できません",
    showing: "直近 10 件を表示",
    customer: "顧客",
    amount: "金額",
    method: "決済手段",
    status: "ステータス",
    time: "時刻",
    empty: "現在、取引データを取得できません。",
    stripeCheckout: "Stripe Checkout",
    sandboxCard: "サンドボックスカード",
  },
  status: {
    succeeded: "成功",
    processing: "処理中",
    failed: "失敗",
    canceled: "キャンセル",
    created: "作成済み",
    refunded: "返金済み",
  },
  flow: {
    label: "MVP 決済フロー",
    blurb: "チェックアウトから会計記録までを可視化し、検証できる経路。",
    steps: ["Next.js アプリ", "バックエンド API", "Stripe サンドボックス", "Webhook イベント", "PostgreSQL"],
  },
  footer: {
    left: "ZEROFAYYZ FINTECH · ポートフォリオ・プロトタイプ",
    right: "サンドボックスデータのみ · 実際の資金移動はありません",
  },
  checkout: {
    error: "決済を開始できませんでした",
    unavailable: "決済 API を現在利用できません",
    amountLabel: "テスト決済の金額（米ドル）",
    amountHint: "$0.50 〜 $10,000.00 の範囲で入力できます",
    amountInvalid: "$0.50 〜 $10,000.00 の範囲で入力してください",
  },
  auth: {
    signIn: "サインイン",
    signOut: "サインアウト",
    adminConsole: "管理コンソール",
    loginTitle: "管理コンソールへのサインイン",
    loginSubtitle:
      "ダッシュボードは公開されています。この先は運用側の領域です：監査ログ、アクティブセッション、アカウント管理。",
    emailLabel: "メールアドレス",
    passwordLabel: "パスワード",
    submitting: "サインイン中…",
    genericError: "サインインできませんでした",
    demoTitle: "レビュアー用アクセス",
    demoIntro:
      "デモ用オペレーターアカウントをご利用ください。誰にも許可を求めずに入れるよう、意図的に公開しています：",
    demoNote:
      "オペレーター権限はすべて閲覧できますが、何も変更できません。管理操作はプラットフォーム所有者に限定されています。",
    demoFill: "自動入力する",
    demoFilled: "入力しました — サインインを押してください",
    signedInAs: (name: string) => `${name} としてサインイン中`,
  },
  admin: {
    title: "管理コンソール",
    subtitle:
      "プラットフォームの特権領域です。このページのすべてのリクエストはサーバー側で再検証されます。パネルの非表示は見た目に過ぎず、境界は API のガードです。",
    roleLabel: "権限",
    presenceTitle: "アクティブセッション",
    presenceSubtitle: "現在サインイン中の全員を、セッションストアから直接表示しています。",
    presenceYou: "これはあなたです",
    presenceRevoke: "このセッションをサインアウト",
    presenceRevoking: "サインアウト中…",
    presenceEmpty: "現在サインイン中のユーザーはいません。",
    presenceColumns: {
      who: "ユーザー",
      role: "権限",
      signedIn: "サインイン時刻",
      lastSeen: "最終アクセス",
      actions: "操作",
    },
    auditTitle: "監査ログ",
    auditSubtitle:
      "追記専用の履歴です。データベースが編集と削除を拒否するため、起きたことは書かれたまま残ります。",
    auditEmpty: "まだ記録はありません。",
    auditColumns: {
      when: "日時",
      action: "アクション",
      actor: "実行者",
      entity: "対象",
    },
    auditSystem: "システム",
    usersTitle: "アカウント",
    usersSubtitle: "スタッフとサンドボックスの顧客、および各顧客の決済回数。",
    usersColumns: {
      who: "ユーザー",
      role: "権限",
      payments: "決済数",
      lastLogin: "最終ログイン",
    },
    usersNever: "なし",
    operatorNotice:
      "オペレーターとしてサインインしています。監査ログは閲覧できますが、セッションとアカウントの管理は管理者に限定されています。",
    loadError: "このパネルを API から読み込めませんでした。",
  },
};

const DICTIONARIES: Record<Locale, Dictionary> = { en, ja };

export function getDictionary(locale: Locale): Dictionary {
  return DICTIONARIES[locale];
}

export type { Dictionary };
