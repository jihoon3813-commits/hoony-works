import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  settings: defineTable({
    budget: v.number(),
    usedBudget: v.number(),
    reservedBudget: v.number(),
    retries: v.number(),
    updatedAt: v.string(),
  }),

  workspaces: defineTable({
    workspaceId: v.string(), // e.g. "brand-120pie"
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
    createdAt: v.string(),
    updatedAt: v.string(),
  }).index("by_workspaceId", ["workspaceId"]),

  campaigns: defineTable({
    workspaceId: v.string(),
    campaignId: v.string(),
    name: v.string(),
    audience: v.string(),
    goal: v.string(),
    topic: v.string(),
    product: v.string(),
    channels: v.array(v.string()),
    designMode: v.string(),
    templateId: v.optional(v.union(v.string(), v.null())),
    template: v.string(),
    preserveProduct: v.boolean(),
    titles: v.array(v.string()),
    caption: v.string(),
    scenes: v.array(v.string()),
    status: v.string(),
    updated: v.string(),
    version: v.number(),
    selectedConceptId: v.optional(v.string()),
  })
    .index("by_workspaceId", ["workspaceId"])
    .index("by_campaignId", ["campaignId"]),

  concepts: defineTable({
    workspaceId: v.string(),
    campaignId: v.string(),
    conceptId: v.string(),
    name: v.string(),
    structureType: v.string(),
    messageDirection: v.string(),
    layoutPlan: v.any(),
    typographyPlan: v.any(),
    photoPlacement: v.any(),
    copyPlan: v.any(),
    backdropDataUrl: v.optional(v.string()),
    assetRefs: v.any(),
    approvedFactsUsed: v.array(v.any()),
    missingWarnings: v.optional(v.array(v.string())),
    selected: v.boolean(),
    version: v.number(),
  })
    .index("by_workspaceId", ["workspaceId"])
    .index("by_campaignId", ["campaignId"]),

  contents: defineTable({
    workspaceId: v.string(),
    campaignId: v.string(),
    channelId: v.string(),
    contentId: v.string(),
    conceptId: v.optional(v.string()),
    layers: v.any(),
    titles: v.array(v.string()),
    caption: v.string(),
    scenes: v.array(v.any()),
    videoSpec: v.optional(v.any()),
    mp4File: v.optional(v.any()),
    state: v.string(),
    approvedVersion: v.optional(v.union(v.number(), v.null())),
    version: v.number(),
  })
    .index("by_workspaceId", ["workspaceId"])
    .index("by_campaignId", ["campaignId"])
    .index("by_channel", ["workspaceId", "channelId"]),

  assets: defineTable({
    workspaceId: v.string(),
    assetId: v.string(),
    name: v.string(),
    role: v.string(),
    type: v.string(),
    img: v.string(),
    menu: v.optional(v.string()),
    tags: v.optional(v.string()),
    sha256: v.optional(v.string()),
    provenance: v.optional(v.string()),
    storageId: v.optional(v.id("_storage")),
    original: v.optional(v.boolean()),
    previewOnly: v.optional(v.boolean()),
    createdAt: v.string(),
  })
    .index("by_workspaceId", ["workspaceId"])
    .index("by_sha256", ["workspaceId", "sha256"]),

  templates: defineTable({
    workspaceId: v.string(),
    templateId: v.string(),
    name: v.string(),
    category: v.string(),
    layout: v.string(),
    bg: v.string(),
    ink: v.string(),
    accent: v.string(),
    subtitle: v.string(),
    custom: v.boolean(),
    visibility: v.optional(v.string()),
  }).index("by_workspaceId", ["workspaceId"]),

  publications: defineTable({
    workspaceId: v.string(),
    campaignId: v.string(),
    channelId: v.string(),
    publicationId: v.string(),
    contentId: v.optional(v.string()),
    contentVersionId: v.optional(v.string()),
    state: v.string(),
    url: v.optional(v.string()),
    remotePostId: v.optional(v.string()),
    at: v.string(),
  }).index("by_workspaceId", ["workspaceId"]),
});
