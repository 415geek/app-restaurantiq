import { workflow, node, links } from '@n8n-as-code/transformer';

// <workflow-map>
// Workflow : My Sub-Workflow 1
// Nodes   : 2  |  Connections: 1
//
// NODE INDEX
// ──────────────────────────────────────────────────────────────────
// Property name                    Node type (short)         Flags
// WhenExecutedByAnotherWorkflow      executeWorkflowTrigger
// ReplaceMeWithYourLogic             noOp
//
// ROUTING MAP
// ──────────────────────────────────────────────────────────────────
// WhenExecutedByAnotherWorkflow
//    → ReplaceMeWithYourLogic
// </workflow-map>

// =====================================================================
// METADATA DU WORKFLOW
// =====================================================================

@workflow({
    id: 'FMdK4FLhPvlBOojS',
    name: 'My Sub-Workflow 1',
    active: false,
    settings: { executionOrder: 'v1', availableInMCP: false },
})
export class MySubWorkflow1Workflow {
    // =====================================================================
    // CONFIGURATION DES NOEUDS
    // =====================================================================

    @node({
        name: 'When Executed by Another Workflow',
        type: 'n8n-nodes-base.executeWorkflowTrigger',
        version: 1.1,
        position: [260, 340],
    })
    WhenExecutedByAnotherWorkflow = {};

    @node({
        name: 'Replace me with your logic',
        type: 'n8n-nodes-base.noOp',
        version: 1,
        position: [520, 340],
    })
    ReplaceMeWithYourLogic = {};

    // =====================================================================
    // ROUTAGE ET CONNEXIONS
    // =====================================================================

    @links()
    defineRouting() {
        this.WhenExecutedByAnotherWorkflow.out(0).to(this.ReplaceMeWithYourLogic.in(0));
    }
}
