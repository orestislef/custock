// the client interface every app uses. the fetch based implementation lives in client.ts.
// web and mobile code against this interface, so a fixture implementation can stand in during
// development and tests.

import type { OpenApiDoc, ServerInfo } from './server-info';
import type { SessionDevice } from './devices';
import type { ClientErrorInput, Issue, IssueDetail, IssuePage, IssueQuery, IssueStatus } from './errors';
import type {
  AudiencePreview, Audience, Category, CategoryInput, Customer, CustomerDetail, DashboardCards, FeedItem,
  GrantableRole, InviteInput, JoinInput, JoinLink, JoinPage, Locale, MeContext, Member,
  Movement, MovementBatchResult, MovementInput, OrgSettings, Post, PostInput, Product,
  ProductInput, PublicProduct, PublicShop, Role, ScanResult, SeriesPoint, Shop, ShopGroup, StockLevel,
  Tokens, ScopeType, Uom,
  AddCustomerInput, AuditEntry, DevOutboxItem, Invite, ShopVariantSettingsInput, StockAlertItem, StockCount,
  StockCountLine, SyncResult, Transfer, TransferInput, UncountedPolicy, UnsubscribePage, PresignInput, PresignResult,
  PushSubscriptionInput, InviteCreated, InvitePreview, InviteRegisterInput, ShopInput,
} from './contract';
import type {
  Order, OrderCounts, OrderCreateInput, OrderHold, OrderListStatus, OrderPreview, OrderPreviewInput, OrderQuoteInput, OrderSummary, PublicOrderOptions,
} from './orders';
import type { BusinessPolicyControl, PlatformPolicyEntry, PolicyEntry, PolicyValue } from './policies';
import type { BusinessPolicyControlsPatch, PolicyPatch } from './policy-schemas';

import type {
  BusinessCreated, NewBusinessInput, OrgControls, OrgControlsPatch, PlatformAuditEntry, PlatformBusiness, PlatformBusinessDetail,
  PlatformInviteInput, PlatformInvitePreview, PlatformOverview, PlatformSettings, PlatformSettingsPatch, SuperAdmins,
} from './platform';

export interface Page<T> { items: T[]; nextCursor: string | null }

export interface ProductQuery {
  q?: string;
  shopId?: string;
  filter?: 'low' | 'out' | 'negative' | 'waiting';
  categoryId?: string;
  cursor?: string;
  limit?: number;
}

export interface CustomerQuery {
  q?: string;
  shopId?: string;
  tag?: string;
  channel?: 'email' | 'push';
  locale?: Locale;
  cursor?: string;
  limit?: number;
}

export interface CustockApi {
  // auth (local dev provider until the real login server is wired)
  login(email: string, password: string): Promise<Tokens>;
  requestOtp(email: string, locale?: Locale): Promise<{ sent: true; devCode?: string }>;
  verifyOtp(email: string, code: string): Promise<Tokens>;
  refresh(refreshToken: string): Promise<Tokens>;
  logout(): Promise<void>;
  me(): Promise<MeContext>;
  // forgot password: always { sent: true }, whether or not the email has an account
  requestPasswordReset(email: string, locale?: Locale): Promise<{ sent: true }>;
  // the reset link page. 410 reset_expired when the link was used, expired or never existed
  passwordResetPreview(token: string): Promise<{ valid: true; expiresAt: number }>;
  // sets the new password, signs out every session of that person and signs this one in
  resetPassword(token: string, password: string): Promise<Tokens>;

  // org
  orgSettings(orgId: string): Promise<OrgSettings>;
  // logoFileId: a 'logo' upload of this business, or null to take the logo off
  updateOrgSettings(orgId: string, patch: Partial<OrgSettings> & { logoFileId?: string | null }): Promise<OrgSettings>;
  // the caller's own shops. all: every shop of the org, for picking a transfer destination
  // (needs stock.transfer.send at some shop)
  shops(orgId: string, opts?: { all?: boolean }): Promise<Shop[]>;
  groups(orgId: string): Promise<ShopGroup[]>;
  updateShop(orgId: string, shopId: string, patch: Partial<Shop>): Promise<Shop>;

  // catalog and stock
  categories(orgId: string): Promise<Category[]>;
  createCategory(orgId: string, input: CategoryInput): Promise<Category>;
  updateCategory(orgId: string, categoryId: string, patch: Partial<CategoryInput>): Promise<Category>;
  deleteCategory(orgId: string, categoryId: string): Promise<void>;
  products(orgId: string, query?: ProductQuery): Promise<Page<Product & { levels: StockLevel[] }>>;
  // levels carry onOrderQty and orderHolds lists the confirmed or ready orders holding it, both only
  // for shops where the caller has orders.view
  product(orgId: string, productId: string): Promise<Product & { levels: StockLevel[]; orderHolds?: OrderHold[] }>;
  createProduct(orgId: string, input: ProductInput): Promise<Product>;
  updateProduct(orgId: string, productId: string, patch: Partial<ProductInput>): Promise<Product>;
  setShopPrice(orgId: string, shopId: string, variantId: string, priceMinor: number | null): Promise<void>;
  scan(orgId: string, code: string, symbology?: string, shopId?: string): Promise<ScanResult>;
  attachBarcode(orgId: string, variantId: string, code: string, packQty?: number): Promise<void>;
  postMovements(orgId: string, movements: MovementInput[]): Promise<MovementBatchResult>;
  movements(orgId: string, query: { shopId?: string; variantId?: string; productId?: string; cursor?: string; limit?: number }): Promise<Page<Movement>>;
  unknownScans(orgId: string, shopId?: string): Promise<{ id: string; code: string; shopId: string; times: number; scannedAt: number }[]>;

  // customers
  customers(orgId: string, query?: CustomerQuery): Promise<Page<Customer>>;
  customer(orgId: string, customerId: string): Promise<CustomerDetail>;
  addCustomerNote(orgId: string, customerId: string, body: string): Promise<void>;
  setCustomerTags(orgId: string, customerId: string, tags: string[]): Promise<void>;
  joinLinks(orgId: string): Promise<JoinLink[]>;
  createJoinLink(orgId: string, input: { scopeType: ScopeType; scopeId: string; label?: string }): Promise<JoinLink>;

  // posts
  posts(orgId: string, query?: { status?: string; cursor?: string }): Promise<Page<Post>>;
  post(orgId: string, postId: string): Promise<Post>;
  createPost(orgId: string, input: PostInput): Promise<Post>;
  updatePost(orgId: string, postId: string, input: PostInput): Promise<Post>;
  previewAudience(orgId: string, audience: Audience, channels: string[]): Promise<AudiencePreview>;
  publishPost(orgId: string, postId: string): Promise<Post>; // publish or submit for approval, server decides by permission
  approvePost(orgId: string, postId: string): Promise<Post>;
  cancelPost(orgId: string, postId: string): Promise<Post>;

  // team
  members(orgId: string): Promise<Member[]>;
  roles(orgId: string): Promise<Role[]>;
  grantableRoles(orgId: string, scopeType: ScopeType, scopeId: string): Promise<GrantableRole[]>;
  // link is always returned so it can be shared by hand. emailed is true only when mail sending is live
  invite(orgId: string, input: InviteInput): Promise<InviteCreated>;
  assignRole(orgId: string, membershipId: string, input: { roleId: string; scopeType: ScopeType; scopeId: string }): Promise<void>;
  removeAssignment(orgId: string, membershipId: string, assignmentId: string): Promise<void>;
  saveRole(orgId: string, input: { id?: string; name: string; rank: number; permissions: string[] }): Promise<Role>;

  // reports
  dashboard(orgId: string, shopId?: string): Promise<DashboardCards>;
  salesSeries(orgId: string, shopId?: string, days?: number): Promise<SeriesPoint[]>;
  // qty is in base units: pieces, or grams/ml/mm when uom is kg/l/m
  topSellers(orgId: string, shopId?: string, days?: number): Promise<{ variantId: string; name: string; qty: number; uom: Uom; valueMinor: number | null }[]>;
  mostWanted(orgId: string, shopId?: string): Promise<{ variantId: string; name: string; waiting: number; onHand: number }[]>;
  joinLinkStats(orgId: string): Promise<{ joinLinkId: string; label: string | null; opens: number; signups: number; confirmed: number }[]>;
  shrinkage(orgId: string, shopId?: string, days?: number): Promise<{ reason: string; qty: number; valueMinor: number | null }[]>;

  // customer side, signed in as a customer (app account)
  feed(cursor?: string): Promise<Page<FeedItem>>;
  offers(): Promise<FeedItem[]>;
  catalog(orgSlug: string, query?: { q?: string; categoryId?: string }): Promise<PublicProduct[]>;
  publicProduct(orgSlug: string, productId: string): Promise<PublicProduct>;
  notifyMe(variantId: string, shopId: string | null): Promise<void>;
  setFavorite(productId: string, saved: boolean): Promise<void>;
  followedShops(): Promise<(Shop & { orgName: string })[]>;
  unfollow(scopeType: ScopeType, scopeId: string): Promise<void>;
  setChannel(orgId: string, channel: 'email' | 'push', on: boolean): Promise<void>;
  exportMyData(): Promise<unknown>;
  // how this account confirms deleting itself: its password, or a code sent by email now
  startAccountDelete(): Promise<{ method: 'password' } | { method: 'code'; sent: true; devCode?: string }>;
  deleteMyAccount(confirm?: { password?: string; code?: string }): Promise<void>;

  // public, no login
  joinPage(code: string): Promise<JoinPage>;
  join(code: string, input: JoinInput): Promise<{ pending: true; devConfirmLink?: string }>;
  confirmJoin(token: string): Promise<{ orgName: string; scopeName: string; orgSlug?: string }>;
  shelfProduct(code: string): Promise<PublicProduct>;

  // ---------------------------------------------------------------- stage 2 additions

  // avatarFileId: an 'avatar' upload of this person, or null to remove the photo
  updateMe(patch: { displayName?: string; locale?: Locale; avatarFileId?: string | null }): Promise<void>;

  // catalog writes
  archiveProduct(orgId: string, productId: string): Promise<void>;
  setBasePrice(orgId: string, variantId: string, priceMinor: number): Promise<void>;
  setShopVariantSettings(orgId: string, shopId: string, variantId: string, input: ShopVariantSettingsInput): Promise<void>;
  nextInternalBarcode(orgId: string): Promise<{ code: string }>;
  resolveUnknownScan(orgId: string, unknownScanId: string, variantId: string | null): Promise<void>;
  sync(orgId: string, shopId: string, cursor?: string | null): Promise<SyncResult>;

  // counts
  counts(orgId: string, query?: { shopId?: string; status?: string }): Promise<StockCount[]>;
  stockCount(orgId: string, countId: string): Promise<StockCount>;
  startCount(orgId: string, shopId: string, input: { kind: 'full' | 'partial'; filter?: Record<string, string> | null }): Promise<StockCount>;
  setCountLine(orgId: string, countId: string, variantId: string, countedQty: number, mode?: 'set' | 'add'): Promise<StockCountLine>;
  submitCount(orgId: string, countId: string): Promise<StockCount>;
  applyCount(orgId: string, countId: string, uncountedPolicy?: UncountedPolicy): Promise<StockCount>;
  cancelCount(orgId: string, countId: string): Promise<StockCount>;

  // transfers
  transfers(orgId: string, query?: { shopId?: string; status?: string }): Promise<Transfer[]>;
  transfer(orgId: string, transferId: string): Promise<Transfer>;
  createTransfer(orgId: string, input: TransferInput): Promise<Transfer>;
  sendTransfer(orgId: string, transferId: string): Promise<Transfer>;
  receiveTransfer(orgId: string, transferId: string, lines: { variantId: string; qtyReceived: number }[]): Promise<Transfer>;
  cancelTransfer(orgId: string, transferId: string): Promise<Transfer>;

  // customers and join links
  addCustomer(orgId: string, input: AddCustomerInput): Promise<Customer>;
  eraseCustomer(orgId: string, customerId: string): Promise<void>;
  updateJoinLink(orgId: string, joinLinkId: string, patch: { label?: string | null; disabled?: boolean }): Promise<JoinLink>;

  // posts
  deletePost(orgId: string, postId: string): Promise<void>;

  // team
  invites(orgId: string): Promise<Invite[]>;
  revokeInvite(orgId: string, inviteId: string): Promise<void>;
  acceptInvite(token: string): Promise<{ orgId: string }>;
  updateMember(orgId: string, membershipId: string, patch: { status: 'active' | 'suspended' | 'removed' }): Promise<void>;
  roleImpact(orgId: string, roleId: string): Promise<{ members: number; names: string[] }>;

  // audit and dev tools
  audit(orgId: string, cursor?: string): Promise<Page<AuditEntry>>;
  devOutbox(limit?: number): Promise<DevOutboxItem[]>;
  devRunJobs(): Promise<{ ran: number }>;

  // customer side
  joinAsCustomer(code: string, input?: { emailNews?: boolean; push?: boolean }): Promise<{ orgName: string; scopeName: string }>;
  follow(scopeType: ScopeType, scopeId: string): Promise<void>;
  alerts(): Promise<StockAlertItem[]>;
  cancelAlert(alertId: string): Promise<void>;
  favorites(): Promise<PublicProduct[]>;

  // public, from the email link
  unsubscribePage(token: string): Promise<UnsubscribePage>;
  unsubscribe(token: string, everything?: boolean): Promise<void>;

  // ---------------------------------------------------------------- security review additions

  // account email change: a code goes to the new address, the old one gets a notice once it is done
  // accounts with a password give it here, a session alone is not enough to move the account
  requestEmailChange(newEmail: string, password?: string): Promise<{ sent: true; devCode?: string }>;
  // public, from the notice to the old address: puts the old email back and signs everyone out
  revertEmailChange(token: string): Promise<{ email: string }>;
  // whether the undo link still works, without using it
  emailRevertPreview(token: string): Promise<{ valid: true }>;
  confirmEmailChange(newEmail: string, code: string): Promise<void>;
  detachBarcode(orgId: string, variantId: string, barcodeId: string): Promise<void>;
  // movements accepted offline that pushed stock below zero in strict mode
  // a signed upload slot for a photo. in dev the api stores the file itself and serves it under /files.
  presignUpload(orgId: string, input: PresignInput): Promise<PresignResult>;
  // an upload slot for the person's own profile photo, not tied to a business
  presignAvatar(input: { mime: PresignInput['mime']; bytes: number }): Promise<PresignResult>;
  negativeReview(orgId: string, shopId?: string): Promise<{ movementId: string; shopId: string; variantId: string; name: string; qtyDelta: number; onHandAfter: number; createdByName: string | null; recordedAt: number }[]>;

  // ---------------------------------------------------------------- web push

  // the VAPID public key for PushManager.subscribe, null when web push is not set up
  pushKey(): Promise<{ publicKey: string } | null>;
  // stores this browser's subscription for the signed in user. orgId scopes it to one business,
  // so a shop's home screen app only gets that shop's pushes. saving the same endpoint again updates it.
  savePushSubscription(input: PushSubscriptionInput): Promise<void>;
  deletePushSubscription(endpoint: string): Promise<void>;
  // one test notification to the caller's own devices: the staff app (orgId null) or one business's app.
  // devices is how many subscriptions or phones it went to, 0 when none has alerts on
  testPush(orgId?: string | null): Promise<{ devices: number }>;
  // the devices signed in to this account (this one marked current), signing one out, or all the
  // others at once (a lost phone)
  otherSessions(): Promise<{ others: number; devices: SessionDevice[] }>;
  signOutDevice(id: string): Promise<void>;
  signOutOthers(): Promise<{ signedOut: number }>;

  // ---------------------------------------------------------------- production onboarding

  // public: the invite link page. 410 invite_expired when used, revoked or old
  invitePreview(token: string): Promise<InvitePreview>;
  // public: a brand new person makes their account from the invite and lands in the org.
  // 409 account_exists when the email already has an account: sign in, then acceptInvite(token)
  registerWithInvite(input: InviteRegisterInput): Promise<Tokens & { orgId: string }>;
  // needs shops.create
  createShop(orgId: string, input: ShopInput): Promise<Shop>;

  // ---------------------------------------------------------------- platform (super admin)
  // every /v1/platform call answers 403 for anyone who is not a super admin

  platformOverview(): Promise<PlatformOverview>;
  platformBusinesses(): Promise<PlatformBusiness[]>;
  platformBusiness(orgId: string): Promise<PlatformBusinessDetail>;
  // a free slug for a business name, greek and cyrillic transliterated
  suggestSlug(name: string): Promise<{ slug: string }>;
  // the business, its roles, first shop and an owner invite (emailed when mail is live)
  createBusiness(input: NewBusinessInput): Promise<BusinessCreated>;
  inviteOwner(orgId: string, input: PlatformInviteInput): Promise<{ id: string; link: string; emailed: boolean }>;
  resendOwnerInvite(orgId: string, inviteId: string): Promise<{ id: string; link: string; emailed: boolean }>;
  revokeOwnerInvite(orgId: string, inviteId: string): Promise<void>;
  setOrgControls(orgId: string, patch: OrgControlsPatch): Promise<OrgControls>;
  // the whole business with everything in it, its photos and the accounts of people only there.
  // confirm is the business web address (slug) typed again
  deleteBusiness(orgId: string, confirm: string): Promise<{ accountsClosed: number; objects: number; rows: number }>;
  platformSettings(): Promise<PlatformSettings>;
  setPlatformSettings(patch: PlatformSettingsPatch): Promise<PlatformSettings>;
  platformAudit(cursor?: string): Promise<Page<PlatformAuditEntry>>;
  superAdmins(): Promise<SuperAdmins>;
  inviteSuperAdmin(input: PlatformInviteInput): Promise<{ id: string; link: string; emailed: boolean }>;
  resendSuperAdminInvite(inviteId: string): Promise<{ id: string; link: string; emailed: boolean }>;
  revokeSuperAdminInvite(inviteId: string): Promise<void>;
  // never the caller, never the last one: 409 last_superadmin / 403 self
  removeSuperAdmin(userId: string): Promise<void>;

  // any member of the business can read what the super admin decided for it
  orgControls(orgId: string): Promise<OrgControls>;

  // the policy engine (policies.ts): limits and options per level, with what the caller may change
  orgPolicies(orgId: string, shopId?: string | null): Promise<{ entries: PolicyEntry[]; mine: Record<string, PolicyValue> }>;
  setOrgPolicies(orgId: string, patch: PolicyPatch): Promise<{ entries: PolicyEntry[] }>;
  shopPolicies(orgId: string, shopId: string): Promise<{ entries: PolicyEntry[] }>;
  setShopPolicies(orgId: string, shopId: string, patch: PolicyPatch): Promise<{ entries: PolicyEntry[] }>;
  rolePolicies(orgId: string, roleId: string): Promise<{ entries: PolicyEntry[] }>;
  setRolePolicies(orgId: string, roleId: string, patch: PolicyPatch): Promise<{ entries: PolicyEntry[] }>;
  memberPolicies(orgId: string, membershipId: string): Promise<{ entries: PolicyEntry[] }>;
  setMemberPolicies(orgId: string, membershipId: string, patch: PolicyPatch): Promise<{ entries: PolicyEntry[] }>;
  myPolicies(orgId: string): Promise<{ entries: PolicyEntry[] }>;
  setMyPolicies(orgId: string, patch: PolicyPatch): Promise<{ entries: PolicyEntry[] }>;
  platformPolicies(): Promise<{ entries: PlatformPolicyEntry[] }>;
  setPlatformPolicies(patch: PolicyPatch): Promise<{ entries: PlatformPolicyEntry[] }>;
  businessPolicies(orgId: string): Promise<{ controls: BusinessPolicyControl[] }>;
  setBusinessPolicies(orgId: string, patch: BusinessPolicyControlsPatch): Promise<{ controls: BusinessPolicyControl[] }>;

  // public: the super admin invite page. 410 invite_expired when used, revoked or old
  platformInvitePreview(token: string): Promise<PlatformInvitePreview>;
  // public: a brand new person makes their account from the invite. 409 account_exists: sign in, then accept
  registerPlatformInvite(input: { token: string; displayName: string; password: string; locale?: Locale }): Promise<Tokens>;
  // signed in with the invited email
  acceptPlatformInvite(token: string): Promise<void>;

  // errors seen in production (super admins only). open issues first, newest first
  platformErrors(query?: IssueQuery): Promise<IssuePage>;
  platformError(id: string): Promise<IssueDetail>;
  setPlatformErrorStatus(id: string, status: IssueStatus): Promise<Issue>;
  // public: a browser reports its own error. fire and forget, rate limited, no personal data
  reportClientError(input: ClientErrorInput): Promise<void>;

  // ---------------------------------------------------------------- orders (thinking/19-orders.md)

  // staff: orders of the shops where the caller has orders.view, newest change first.
  // status: one status, or open / closed
  orders(orgId: string, query?: { status?: OrderListStatus; shopId?: string; cursor?: string; limit?: number }): Promise<Page<OrderSummary>>;
  // open orders per status, for the menu badge and Home
  orderCounts(orgId: string, shopId?: string): Promise<OrderCounts>;
  order(orgId: string, orderId: string): Promise<Order>;
  // orders.quote: a price for every line (quantities may change). the customer answers
  quoteOrder(orgId: string, orderId: string, input: OrderQuoteInput): Promise<Order>;
  // orders.quote: a priced order as it is
  confirmOrder(orgId: string, orderId: string): Promise<Order>;
  // orders.quote: before any price, with a reason the customer reads
  declineOrder(orgId: string, orderId: string, reason: string): Promise<Order>;
  // orders.fulfil
  readyOrder(orgId: string, orderId: string): Promise<Order>;
  // orders.fulfil: picked up. takes the stock off as sales when policy orders.takeStock is on.
  // 409 negative_stock_blocked when the business does not sell below zero and stock is short
  completeOrder(orgId: string, orderId: string): Promise<Order>;
  // orders.quote: any open order, with a reason the customer reads
  cancelOrder(orgId: string, orderId: string, reason: string): Promise<Order>;

  // customer side, in one business's app. 403 orders_off when it takes no orders
  orderOptions(orgSlug: string): Promise<PublicOrderOptions>;
  // the shops customers can see, with address, phone and opening hours (no sign in needed)
  publicShops(orgSlug: string): Promise<PublicShop[]>;
  previewOrder(orgSlug: string, input: OrderPreviewInput): Promise<OrderPreview>;
  // 409 prices_changed when a price differs from the one the app showed (preview again),
  // 403 limit_reached over a limit, 403 forbidden when not following the business
  placeOrder(orgSlug: string, input: OrderCreateInput): Promise<Order>;
  myOrders(orgSlug: string, query?: { status?: OrderListStatus; cursor?: string; limit?: number }): Promise<Page<OrderSummary>>;
  myOrder(orgSlug: string, orderId: string): Promise<Order>;
  // 410 quote_expired when the price ran out
  acceptQuote(orgSlug: string, orderId: string): Promise<Order>;
  rejectQuote(orgSlug: string, orderId: string): Promise<Order>;
  // while requested or quoted
  cancelMyOrder(orgSlug: string, orderId: string, reason?: string | null): Promise<Order>;

  // ---------------------------------------------------------------- developer (super admin)
  // the api description. public in dev, super admins only in production
  openApi(): Promise<OpenApiDoc>;
  // build, uptime, database, sending, storage and worker state. no secrets, super admins only
  platformServer(): Promise<ServerInfo>;
}
