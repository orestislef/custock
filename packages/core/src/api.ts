// the client interface every app uses. the fetch based implementation lives in client.ts.
// web and mobile code against this interface, so a fixture implementation can stand in during
// development and tests.

import type {
  AudiencePreview, Audience, Category, Customer, CustomerDetail, DashboardCards, FeedItem,
  GrantableRole, InviteInput, JoinInput, JoinLink, JoinPage, Locale, MeContext, Member,
  Movement, MovementBatchResult, MovementInput, OrgSettings, Post, PostInput, Product,
  ProductInput, PublicProduct, Role, ScanResult, SeriesPoint, Shop, ShopGroup, StockLevel,
  Tokens, ScopeType, Uom,
  AddCustomerInput, AuditEntry, DevOutboxItem, Invite, ShopVariantSettingsInput, StockAlertItem, StockCount,
  StockCountLine, SyncResult, Transfer, TransferInput, UncountedPolicy, UnsubscribePage,
} from './contract';

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

  // org
  orgSettings(orgId: string): Promise<OrgSettings>;
  updateOrgSettings(orgId: string, patch: Partial<OrgSettings>): Promise<OrgSettings>;
  shops(orgId: string): Promise<Shop[]>;
  groups(orgId: string): Promise<ShopGroup[]>;
  updateShop(orgId: string, shopId: string, patch: Partial<Shop>): Promise<Shop>;

  // catalog and stock
  categories(orgId: string): Promise<Category[]>;
  products(orgId: string, query?: ProductQuery): Promise<Page<Product & { levels: StockLevel[] }>>;
  product(orgId: string, productId: string): Promise<Product & { levels: StockLevel[] }>;
  createProduct(orgId: string, input: ProductInput): Promise<Product>;
  updateProduct(orgId: string, productId: string, patch: Partial<ProductInput>): Promise<Product>;
  setShopPrice(orgId: string, shopId: string, variantId: string, priceMinor: number | null): Promise<void>;
  scan(orgId: string, code: string, symbology?: string, shopId?: string): Promise<ScanResult>;
  attachBarcode(orgId: string, variantId: string, code: string, packQty?: number): Promise<void>;
  postMovements(orgId: string, movements: MovementInput[]): Promise<MovementBatchResult>;
  movements(orgId: string, query: { shopId?: string; variantId?: string; cursor?: string; limit?: number }): Promise<Page<Movement>>;
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
  invite(orgId: string, input: InviteInput): Promise<{ id: string; devLink?: string }>;
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
  deleteMyAccount(): Promise<void>;

  // public, no login
  joinPage(code: string): Promise<JoinPage>;
  join(code: string, input: JoinInput): Promise<{ pending: true; devConfirmLink?: string }>;
  confirmJoin(token: string): Promise<{ orgName: string; scopeName: string }>;
  shelfProduct(code: string): Promise<PublicProduct>;

  // ---------------------------------------------------------------- stage 2 additions

  updateMe(patch: { displayName?: string; locale?: Locale }): Promise<void>;

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
  requestEmailChange(newEmail: string): Promise<{ sent: true; devCode?: string }>;
  confirmEmailChange(newEmail: string, code: string): Promise<void>;
  detachBarcode(orgId: string, variantId: string, barcodeId: string): Promise<void>;
  // movements accepted offline that pushed stock below zero in strict mode
  negativeReview(orgId: string, shopId?: string): Promise<{ movementId: string; shopId: string; variantId: string; name: string; qtyDelta: number; onHandAfter: number; createdByName: string | null; recordedAt: number }[]>;
}
