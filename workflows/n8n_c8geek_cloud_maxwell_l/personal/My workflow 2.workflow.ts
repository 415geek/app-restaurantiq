import { workflow, node, links } from '@n8n-as-code/transformer';

// <workflow-map>
// Workflow : My workflow 2
// Nodes   : 2  |  Connections: 1
//
// NODE INDEX
// ──────────────────────────────────────────────────────────────────
// Property name                    Node type (short)         Flags
// WhenClickingexecuteWorkflow        manualTrigger
// Smartsearch                        smartSearch
//
// ROUTING MAP
// ──────────────────────────────────────────────────────────────────
// WhenClickingexecuteWorkflow
//    → Smartsearch
// </workflow-map>

// =====================================================================
// METADATA DU WORKFLOW
// =====================================================================

@workflow({
    id: '5UVxnBaLxJAb5JkA',
    name: 'My workflow 2',
    active: false,
    settings: { executionOrder: 'v1', binaryMode: 'separate', availableInMCP: false },
})
export class MyWorkflow2Workflow {
    // =====================================================================
    // CONFIGURATION DES NOEUDS
    // =====================================================================

    @node({
        name: 'When clicking ‘Execute workflow’',
        type: 'n8n-nodes-base.manualTrigger',
        version: 1,
        position: [-256, -96],
    })
    WhenClickingexecuteWorkflow = {};

    @node({
        name: 'SmartSearch',
        type: '@cloudsway-ai/n8n-nodes-cloudsway.smartSearch',
        version: 1,
        position: [-48, -96],
    })
    Smartsearch = {
        additionalFields: {},
        requestOptions: {},
    };

    // =====================================================================
    // ROUTAGE ET CONNEXIONS
    // =====================================================================

    @links()
    defineRouting() {
        this.WhenClickingexecuteWorkflow.out(0).to(this.Smartsearch.in(0));
    }
}
