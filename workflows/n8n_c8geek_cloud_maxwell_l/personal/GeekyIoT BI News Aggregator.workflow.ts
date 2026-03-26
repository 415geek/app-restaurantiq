import { workflow, node, links } from '@n8n-as-code/transformer';

// <workflow-map>
// Workflow : GeekyIoT BI News Aggregator
// Nodes   : 2  |  Connections: 1
//
// NODE INDEX
// ──────────────────────────────────────────────────────────────────
// Property name                    Node type (short)         Flags
// ScheduleTrigger                    scheduleTrigger
// SyncGeneralFeeds                   httpRequest
//
// ROUTING MAP
// ──────────────────────────────────────────────────────────────────
// ScheduleTrigger
//    → SyncGeneralFeeds
// </workflow-map>

// =====================================================================
// METADATA DU WORKFLOW
// =====================================================================

@workflow({
    id: 'GkBIFeed20260304',
    name: 'GeekyIoT BI News Aggregator',
    active: true,
    settings: { executionOrder: 'v1', binaryMode: 'separate', availableInMCP: false },
})
export class GeekyiotBiNewsAggregatorWorkflow {
    // =====================================================================
    // CONFIGURATION DES NOEUDS
    // =====================================================================

    @node({
        name: 'Schedule Trigger',
        type: 'n8n-nodes-base.scheduleTrigger',
        version: 1.2,
        position: [-260, 20],
    })
    ScheduleTrigger = {
        rule: {
            interval: [
                {
                    field: 'hours',
                    hoursInterval: 4,
                },
            ],
        },
    };

    @node({
        name: 'Sync General Feeds',
        type: 'n8n-nodes-base.httpRequest',
        version: 4.4,
        position: [40, 20],
    })
    SyncGeneralFeeds = {
        url: 'http://geekyiot-web:3000/api/sync?type=general&secret=__REPLACE_WITH_GEEKYIOT_SYNC_SECRET__',
        options: {},
    };

    // =====================================================================
    // ROUTAGE ET CONNEXIONS
    // =====================================================================

    @links()
    defineRouting() {
        this.ScheduleTrigger.out(0).to(this.SyncGeneralFeeds.in(0));
    }
}
