import { workflow, node, links } from '@n8n-as-code/transformer';

// <workflow-map>
// Workflow : My workflow 3
// Nodes   : 1  |  Connections: 0
//
// NODE INDEX
// ──────────────────────────────────────────────────────────────────
// Property name                    Node type (short)         Flags
// StickyNote                         stickyNote
//
// ROUTING MAP
// ──────────────────────────────────────────────────────────────────
// </workflow-map>

// =====================================================================
// METADATA DU WORKFLOW
// =====================================================================

@workflow({
    id: 'hbhwayBvzQjAJT7g',
    name: 'My workflow 3',
    active: false,
    settings: { executionOrder: 'v1', binaryMode: 'separate', availableInMCP: false },
})
export class MyWorkflow3Workflow {
    // =====================================================================
    // CONFIGURATION DES NOEUDS
    // =====================================================================

    @node({
        name: 'Sticky Note',
        type: 'n8n-nodes-base.stickyNote',
        version: 1,
        position: [32, -16],
    })
    StickyNote = {};

    // =====================================================================
    // ROUTAGE ET CONNEXIONS
    // =====================================================================

    @links()
    defineRouting() {
        // No connections defined
    }
}
