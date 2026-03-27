import { workflow, node, links } from '@n8n-as-code/transformer';

// <workflow-map>
// Workflow : GeekyIoT Restaurant IQ Feed
// Nodes   : 2  |  Connections: 1
//
// NODE INDEX
// ──────────────────────────────────────────────────────────────────
// Property name                    Node type (short)         Flags
// ScheduleTrigger                    scheduleTrigger
// SyncRestaurantFeed                 httpRequest
//
// ROUTING MAP
// ──────────────────────────────────────────────────────────────────
// ScheduleTrigger
//    → SyncRestaurantFeed
// </workflow-map>

// =====================================================================
// METADATA DU WORKFLOW
// =====================================================================

@workflow({
    id: 'GkRestFeed260304',
    name: 'GeekyIoT Restaurant IQ Feed',
    active: true,
    settings: { executionOrder: 'v1', binaryMode: 'separate', availableInMCP: false },
})
export class GeekyiotRestaurantIqFeedWorkflow {
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
                    hoursInterval: 2,
                },
            ],
        },
    };

    @node({
        name: 'Sync Restaurant Feed',
        type: 'n8n-nodes-base.httpRequest',
        version: 4.4,
        position: [40, 20],
    })
    SyncRestaurantFeed = {
        url: 'http://geekyiot-web:3000/api/sync?type=restaurant&secret=1f0e15371fb7b83c2b4626b15c811c5d803f9e0a3f0ec475',
        options: {},
    };

    // =====================================================================
    // ROUTAGE ET CONNEXIONS
    // =====================================================================

    @links()
    defineRouting() {
        this.ScheduleTrigger.out(0).to(this.SyncRestaurantFeed.in(0));
    }
}
