import { workflow, node, links } from '@n8n-as-code/transformer';

// <workflow-map>
// Workflow : My workflow
// Nodes   : 2  |  Connections: 1
//
// NODE INDEX
// ──────────────────────────────────────────────────────────────────
// Property name                    Node type (short)         Flags
// OnFormSubmission                   formTrigger
// HttpRequest                        httpRequest
//
// ROUTING MAP
// ──────────────────────────────────────────────────────────────────
// OnFormSubmission
//    → HttpRequest
// </workflow-map>

// =====================================================================
// METADATA DU WORKFLOW
// =====================================================================

@workflow({
    id: 'Z0tHDM8njmwvH4ji',
    name: 'My workflow',
    active: false,
    settings: { executionOrder: 'v1', binaryMode: 'separate', availableInMCP: false },
})
export class MyWorkflow {
    // =====================================================================
    // CONFIGURATION DES NOEUDS
    // =====================================================================

    @node({
        name: 'On form submission',
        type: 'n8n-nodes-base.formTrigger',
        version: 2.5,
        position: [-240, -144],
    })
    OnFormSubmission = {
        formTitle: '竞对监控',
        formFields: {
            values: [
                {
                    fieldLabel: '竞对地址',
                },
                {
                    fieldLabel: '=',
                },
            ],
        },
        options: {},
    };

    @node({
        name: 'HTTP Request',
        type: 'n8n-nodes-base.httpRequest',
        version: 4.4,
        position: [32, -128],
    })
    HttpRequest = {
        url: 'https://www.doordash.com/home',
        options: {},
    };

    // =====================================================================
    // ROUTAGE ET CONNEXIONS
    // =====================================================================

    @links()
    defineRouting() {
        this.OnFormSubmission.out(0).to(this.HttpRequest.in(0));
    }
}
