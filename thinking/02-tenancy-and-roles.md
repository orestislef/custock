# 02. tenancy and roles

How businesses, shops and people fit together, and how power flows from the top down.

## the tree

```
platform (me)
 └── organization            the business, the tenant. owns everything below
      ├── shop groups        optional. "athens shops", "outlets". a shop can be in many groups
      ├── shops              a physical location. has its own stock, staff, join links
      ├── catalog            products and variants, shared by all shops of the org
      ├── members            people who work for the business, with roles at a scope
      └── customers          people who buy, subscribed to the org, groups or shops
```

**decided:**

- the **organization** is the tenant. every row of business data carries an `org_id`. nothing
  ever crosses between organizations.
- the **catalog is per organization**, not per shop. one product, one barcode, stock counted
  per shop. a shop can override the price and hide a product it does not sell.
- **shop groups** are just labels with power: a role given on a group applies to every shop in
  the group, now and later. groups can overlap.
- a shop with one location and no groups is the simple case and must feel simple. if an org
  has one shop, the app never shows the words "group" or "organization" unless you go looking.

## scopes

A role is never given "in general". It is given **at a scope**:

| scope | covers |
|-------|--------|
| `org` | the whole organization, every shop and group, now and later |
| `group` | every shop inside that group, now and later |
| `shop` | that one shop |

A member can have many assignments. Example: Maria is **manager** at shop Kifisia and **staff**
at shop Marousi. In Kifisia she manages, in Marousi she scans.

**effective permissions at a shop** = the union of permissions from every role assigned to you at
the org, at any group that contains the shop, and at the shop itself.

**effective rank at a shop** = the highest rank among those same roles.

Some permissions only make sense for the whole business (billing, roles, creating shops). Those
are **org level** permissions and only count when the role is assigned at `org` scope. The full
list with levels is in [03-permissions](03-permissions.md).

## roles and rank

A role is a named bundle of permissions plus a **rank** (1 to 100). Rank is what stops peers from
fighting and stops anyone from managing upwards.

| default role | rank | usual scope |
|--------------|------|-------------|
| owner | 100 | org |
| admin | 80 | org |
| manager | 60 | group or shop |
| staff | 40 | shop |
| viewer | 20 | any |

Owners and admins can create **custom roles** ("cashier", "stock keeper", "marketing"). A custom
role gets a rank below its creator's, and only permissions its creator has.

## delegation rules

This is the core of "managers get what the one above them gives them". The server checks all of
these on every change, the app only uses them to grey things out.

1. **scope rule.** you can only manage people and things inside scopes you cover. a shop manager
   cannot touch another shop, and cannot give anyone a group or org role.
2. **ceiling rule.** you can only give a role if every permission in it is a permission you have
   yourself at that scope. you can never hand out more than you hold.
3. **rank rule.** you can only give roles with a rank lower than yours at that scope, and you can
   only change or remove people whose rank there is lower than yours. two managers of the same
   shop cannot remove each other. only someone above them can.
4. **no self service.** nobody edits their own assignments, not even the owner. the owner does not
   need to, they already have everything.
5. **roles are live.** if an admin removes a permission from a role, everyone with that role loses
   it on their next request. adding a permission to a role follows the ceiling rule too.
6. **custom roles follow the ceiling.** you build a role only from permissions you have, with a
   rank under yours. if your own permissions shrink later, the role keeps what it has, but you can
   no longer edit it unless you cover it again.

### examples

| who tries | what | result |
|-----------|------|--------|
| manager of Kifisia | invite someone as staff at Kifisia | ok |
| manager of Kifisia | invite someone as staff at Marousi | no, scope rule |
| manager of Kifisia | invite someone as manager at Kifisia | no, rank rule (same rank) |
| manager of Kifisia | give staff the `customers.export` permission they do not have | no, ceiling rule |
| manager of Kifisia | remove another manager of Kifisia | no, rank rule |
| admin | make a custom role "senior staff" with rank 50 | ok, if all its permissions are ones the admin holds |
| admin | change the owner's role | no, rank rule |
| admin | remove themselves | no, self service rule. they can leave the org, which is different |

## the owner

- every organization has **at least one owner**, always. the server refuses anything that would
  leave zero owners.
- more than one owner is allowed (business partners).
- **ownership transfer**: an owner picks another member, that member accepts, then the old owner
  can stay as owner, become admin, or leave. logged in the audit log.
- an owner cannot leave or delete their account while they are the last owner. they transfer
  first or delete the organization.

## membership states

| state | meaning |
|-------|---------|
| invited | an invite exists, the person has not accepted yet. not a member |
| active | normal |
| suspended | cannot use this org, keeps their history and assignments. good for seasonal staff |
| removed | gone. history stays, they show as "former member" in logs |

A person can be a member of many organizations (a manager who also helps a friend's shop). The app
lets them switch organization, see [07-auth](07-auth.md).

## customers are not members

Customers are a separate thing. They belong to an organization as **customer records**, not as
members, and have no roles. One real person can be:

- a customer of org A and org B. A and B never learn about each other. two separate customer
  records, two separate consents.
- staff at a shop and also a customer of the same org. two separate things again, the app shows a
  switch between "work" and "my shops".

Which customers a member can see:

- with customer permissions at `org` scope: all customers of the org.
- with customer permissions only at some shops: customers whose subscriptions reach any of those
  shops. a customer subscribed to the whole org reaches every shop, so every shop manager sees them.

## platform admin (me)

- separate from organization roles. a platform admin is not a member of any org by default.
- can see organizations, usage, health, and do support actions like resending an invite.
- **cannot see business data** (customers, stock, posts) unless the org has turned on
  "support access" for a limited time. while that is on, every action is in the org's audit log
  and the org sees a banner.

## legal side, short

Each organization is the **data controller** for its customers. Custock (me) is the **processor**.
That means a simple data processing agreement in the terms, and it is also why one org must never
see another org's customers even when it is the same email.
