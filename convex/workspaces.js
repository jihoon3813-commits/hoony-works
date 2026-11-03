import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// Get all workspaces and high-level counts
export const listWorkspaces = query({
  handler: async (ctx) => {
    return await ctx.db.query("workspaces").collect();
  },
});

// Hydrate full workspace state (campaigns, assets, templates, publications, concepts, contents)
export const getFullWorkspace = query({
  args: { workspaceId: v.string() },
  handler: async (ctx, args) => {
    const ws = await ctx.db
      .query("workspaces")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", args.workspaceId))
      .first();

    if (!ws) return null;

    const campaigns = await ctx.db
      .query("campaigns")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();

    const assets = await ctx.db
      .query("assets")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();

    const templates = await ctx.db
      .query("templates")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();

    const concepts = await ctx.db
      .query("concepts")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();

    const contents = await ctx.db
      .query("contents")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();

    const publications = await ctx.db
      .query("publications")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();

    return {
      ...ws,
      campaigns,
      uploads: assets,
      templates,
      concepts,
      contents,
      publications,
    };
  },
});

// Upsert a workspace
export const upsertWorkspace = mutation({
  args: {
    workspaceId: v.string(),
    accountId: v.optional(v.string()),
    name: v.string(),
    category: v.string(),
    color: v.string(),
    audience: v.string(),
    description: v.string(),
    tone: v.string(),
    cta: v.string(),
    approvedFacts: v.array(v.any()),
    links: v.any(),
    accounts: v.any(),
    catalog: v.array(v.any()),
    version: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("workspaces")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", args.workspaceId))
      .first();

    const now = new Date().toISOString();
    if (existing) {
      await ctx.db.patch(existing._id, {
        ...args,
        updatedAt: now,
      });
      return existing._id;
    } else {
      return await ctx.db.insert("workspaces", {
        ...args,
        createdAt: now,
        updatedAt: now,
      });
    }
  },
});

// Bulk sync from browser state to Convex cloud
export const bulkSyncFromClient = mutation({
  args: {
    workspaces: v.array(v.any()),
    settings: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const now = new Date().toISOString();
    const result = { syncedWorkspaces: 0, syncedCampaigns: 0, syncedAssets: 0 };

    if (args.settings) {
      const existingSettings = await ctx.db.query("settings").first();
      if (existingSettings) {
        await ctx.db.patch(existingSettings._id, {
          budget: args.settings.budget || 50000,
          usedBudget: args.settings.usedBudget || 0,
          reservedBudget: args.settings.reservedBudget || 0,
          retries: args.settings.retries || 2,
          updatedAt: now,
        });
      } else {
        await ctx.db.insert("settings", {
          budget: args.settings.budget || 50000,
          usedBudget: args.settings.usedBudget || 0,
          reservedBudget: args.settings.reservedBudget || 0,
          retries: args.settings.retries || 2,
          updatedAt: now,
        });
      }
    }

    for (const ws of args.workspaces) {
      const wsId = ws.id || ws.workspaceId;
      if (!wsId) continue;

      // 1. Workspace
      const existingWs = await ctx.db
        .query("workspaces")
        .withIndex("by_workspaceId", (q) => q.eq("workspaceId", wsId))
        .first();

      const wsRecord = {
        workspaceId: wsId,
        accountId: ws.accountId || "user-jh",
        name: ws.brand?.name || ws.name || "상품",
        category: ws.brand?.category || ws.category || "기타",
        color: ws.brand?.color || ws.color || "#7661dc",
        audience: ws.brand?.audience || ws.audience || "",
        description: ws.brand?.description || ws.description || "",
        tone: ws.brand?.tone || ws.tone || "",
        cta: ws.brand?.cta || ws.cta || "자세히 알아보기",
        approvedFacts: ws.brand?.approvedFacts || ws.approvedFacts || [],
        links: ws.brand?.links || ws.links || {},
        accounts: ws.brand?.accounts || ws.accounts || {},
        catalog: ws.catalog || [],
        version: ws.version || 1,
        updatedAt: now,
      };

      if (existingWs) {
        await ctx.db.patch(existingWs._id, wsRecord);
      } else {
        await ctx.db.insert("workspaces", {
          ...wsRecord,
          createdAt: ws.createdAt || now,
        });
      }
      result.syncedWorkspaces++;

      // 2. Campaigns
      if (Array.isArray(ws.campaigns)) {
        for (const c of ws.campaigns) {
          const cId = c.id || c.campaignId;
          if (!cId) continue;
          const existingCamp = await ctx.db
            .query("campaigns")
            .withIndex("by_campaignId", (q) => q.eq("campaignId", cId))
            .first();

          const campRecord = {
            workspaceId: wsId,
            campaignId: cId,
            name: c.name || "캠페인",
            audience: c.audience || "consumer",
            goal: c.goal || "홍보",
            topic: c.topic || "",
            product: c.product || "primary",
            channels: c.channels || ["instagram"],
            designMode: c.designMode || "creative",
            templateId: c.templateId || null,
            template: c.template || "yellow",
            preserveProduct: c.preserveProduct !== false,
            titles: c.titles || [],
            caption: c.caption || "",
            scenes: c.scenes || [],
            status: c.status || "초안",
            updated: c.updated || "내 초안",
            version: c.version || 1,
            selectedConceptId: c.selectedConceptId,
          };

          if (existingCamp) {
            await ctx.db.patch(existingCamp._id, campRecord);
          } else {
            await ctx.db.insert("campaigns", campRecord);
          }
          result.syncedCampaigns++;
        }
      }

      // 3. Assets
      const assetsList = ws.uploads || ws.assets || [];
      if (Array.isArray(assetsList)) {
        for (const a of assetsList) {
          const aId = a.id || a.assetId;
          if (!aId) continue;
          const existingAsset = await ctx.db
            .query("assets")
            .withIndex("by_workspaceId", (q) => q.eq("workspaceId", wsId))
            .filter((q) => q.eq(q.field("assetId"), aId))
            .first();

          const assetRecord = {
            workspaceId: wsId,
            assetId: aId,
            name: a.name || "자료",
            role: a.role || "product",
            type: a.type || "실제 제품·서비스 사진",
            img: a.img || "",
            menu: a.menu || "",
            tags: a.tags || "",
            sha256: a.sha256,
            provenance: a.provenance,
            original: a.original,
            previewOnly: a.previewOnly,
            createdAt: a.createdAt || now,
          };

          if (existingAsset) {
            await ctx.db.patch(existingAsset._id, assetRecord);
          } else {
            await ctx.db.insert("assets", assetRecord);
          }
          result.syncedAssets++;
        }
      }

      // 4. Templates
      if (Array.isArray(ws.templates)) {
        for (const t of ws.templates) {
          const tId = t.id || t.templateId;
          if (!tId) continue;
          const existingTpl = await ctx.db
            .query("templates")
            .withIndex("by_workspaceId", (q) => q.eq("workspaceId", wsId))
            .filter((q) => q.eq(q.field("templateId"), tId))
            .first();

          const tplRecord = {
            workspaceId: wsId,
            templateId: tId,
            name: t.name || "템플릿",
            category: t.category || "상품 소개",
            layout: t.layout || "signature",
            bg: t.bg || "#f4cc59",
            ink: t.ink || "#292e27",
            accent: t.accent || "#ffe9a4",
            subtitle: t.subtitle || "",
            custom: Boolean(t.custom),
            visibility: t.visibility || "workspace",
          };

          if (existingTpl) {
            await ctx.db.patch(existingTpl._id, tplRecord);
          } else {
            await ctx.db.insert("templates", tplRecord);
          }
        }
      }
    }

    return result;
  },
});
