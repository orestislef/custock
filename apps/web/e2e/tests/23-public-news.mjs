// news for everyone: a business that keeps its posts for followers shows a visitor the sign in
// card on News. once it shows them to everyone, the visitor sees the sent posts with a soft invite
// to follow, and a notification's link to one post lands on that post.
import { L, expect, go, lemoni, login, ok, open, q, see, seed, test, text } from '../lib.mjs';

test('customer side', 'news for everyone: a visitor sees the posts only when the business shows them to all', async (t) => {
  const l = await lemoni();
  const owner = await login(seed.owner);
  const set = (body) => ok(`/v1/orgs/${l.orgId}`, { method: 'PATCH', token: owner, body });
  // whatever earlier tests left: an open catalog, news for followers
  await set({ customerCatalog: 'public', customerNews: 'followers' });

  try {
    t.step('followers only: a visitor gets the sign in card, no posts');
    const visitor = await open(t, { device: 'phone' });
    await go(visitor, '/s/lemoni/news');
    await see(visitor, L('shopper.news.signInTitle'), 15000);
    const before = await text(visitor);
    expect(!before.includes('We open earlier on Saturdays'), 'no post for a visitor', 'no post', 'the sample news post shows');

    t.step('everyone: the visitor sees the sent posts and the invite to follow');
    await set({ customerNews: 'everyone' });
    const feed = await ok('/v1/public/orgs/lemoni/posts', { headers: { 'Accept-Language': 'en' } });
    expect(feed.items.length > 0, 'public posts', 'some', '0');
    const news = feed.items.find((i) => i.post.translations.en?.title === 'We open earlier on Saturdays');
    expect(!!news, 'the sample news post is public', 'found', feed.items.map((i) => i.post.translations.en?.title).join(', '));
    await go(visitor, '/s/lemoni/news');
    await see(visitor, L('shopper.news.visitorTitle'), 15000);
    await see(visitor, 'We open earlier on Saturdays');
    const after = await text(visitor);
    expect(!after.includes(L('shopper.news.signInTitle')), 'no sign in card', 'the posts instead', 'sign in card still there');
    // a draft, a scheduled or a cancelled post never shows
    const sentTitles = new Set(feed.items.map((i) => i.post.translations.en?.title));
    const unsent = q("SELECT tr.title FROM posts p JOIN post_translations tr ON tr.post_id = p.id AND tr.locale = 'en' WHERE p.org_id = @o AND p.status <> 'sent'", { o: l.orgId })
      .map((r) => r.title).filter((x) => x && !sentTitles.has(x));
    expect(unsent.length > 0, 'the sample has posts not sent', 'some', '0');
    for (const title of unsent) expect(!after.includes(title), `no ${title}`, 'not shown', 'shown');

    t.step('a notification link to one post lands on it');
    await go(visitor, `/s/lemoni/news?post=${encodeURIComponent(news.post.id)}`);
    const card = visitor.locator(`#post-${news.post.id}`);
    await card.waitFor({ state: 'visible', timeout: 10000 });
    const ring = (el) => getComputedStyle(el).boxShadow;
    const marked = await card.locator('article').evaluate(ring);
    // another post on the page, not marked
    const other = await visitor.locator(`li[id^="post-"]:not(#post-${news.post.id}) article`).first().evaluate(ring);
    expect(marked !== other, 'the post is marked', 'a ring unlike the others', `${marked} vs ${other}`);

    t.step('back to followers: the visitor is invited in again');
    await set({ customerNews: 'followers' });
    await go(visitor, '/s/lemoni/news');
    await see(visitor, L('shopper.news.signInTitle'), 15000);
  } finally {
    await set({ customerNews: 'followers' });
  }
});
