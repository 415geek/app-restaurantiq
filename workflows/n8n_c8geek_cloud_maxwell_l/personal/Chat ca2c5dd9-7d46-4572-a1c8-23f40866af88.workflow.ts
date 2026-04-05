import { workflow, node, links } from '@n8n-as-code/transformer';

// <workflow-map>
// Workflow : Chat ca2c5dd9-7d46-4572-a1c8-23f40866af88
// Nodes   : 8  |  Connections: 5
//
// NODE INDEX
// ──────────────────────────────────────────────────────────────────
// Property name                    Node type (short)         Flags
// WhenChatMessageReceived            chatTrigger
// AiAgent                            agent                      [AI]
// ChatModel                          lmChatOpenAi               [creds]
// Memory                             memoryBufferWindow
// RestoreChatMemory                  memoryManager              [AI]
// ClearChatMemory                    memoryManager              [AI]
// Merge                              merge
// CodeTool                           toolCode
//
// ROUTING MAP
// ──────────────────────────────────────────────────────────────────
// WhenChatMessageReceived
//    → RestoreChatMemory
//      → Merge.in(1)
//        → AiAgent
//          → ClearChatMemory
//    → Merge (↩ loop)
//
// AI CONNECTIONS
// ChatModel.uses({ ai_languageModel: AiAgent })
// Memory.uses({ ai_memory: AiAgent, ai_memory: RestoreChatMemory, ai_memory: ClearChatMemory })
// CodeTool.uses({ ai_tool: [CodeTool] })
// </workflow-map>

// =====================================================================
// METADATA DU WORKFLOW
// =====================================================================

@workflow({
    id: 'x322eGYB0p3UNkry',
    name: 'Chat ca2c5dd9-7d46-4572-a1c8-23f40866af88',
    active: false,
    settings: { executionOrder: 'v1', callerPolicy: 'workflowsFromSameOwner', availableInMCP: false },
})
export class ChatCa2c5dd97d464572A1c823f40866af88Workflow {
    // =====================================================================
    // CONFIGURATION DES NOEUDS
    // =====================================================================

    @node({
        name: 'When chat message received',
        type: '@n8n/n8n-nodes-langchain.chatTrigger',
        version: 1.4,
        position: [-448, -112],
    })
    WhenChatMessageReceived = {};

    @node({
        name: 'AI Agent',
        type: '@n8n/n8n-nodes-langchain.agent',
        version: 3,
        position: [608, 0],
    })
    AiAgent = {
        promptType: 'define',
        text: "={{ $('When chat message received').item.json.chatInput }}",
        options: {
            enableStreaming: true,
            maxTokensFromMemory: 996147,
            systemMessage:
                "You are a helpful assistant.\n\n\n# Current Date and Time\n\nThe user's current local date and time is: 2026-03-30T12:52:42.752-07:00 (timezone: America/Los_Angeles).\nWhen you need to reference \"now\", use this date and time.\n\n# Output Capabilities\n\n## Multimedia Generation\n\nYou are allowed to describe, explain and analyze provided multimedia data if you're capable of, but not allowed to create, generate, edit, or display images, videos, or other non-text content.\nIf the user asks you to generate or edit an image (or other media), explain that you are not able to do that and, if helpful, describe in words what the image could look like or how they could create it using external tools.\n\n## Document Generation\n\nYou can create and edit documents for the user using special XML-like commands. When you use these commands, documents appear in a side panel next to this chat where users can view them in real-time. You can create multiple documents in a conversation, and users can switch between them using a dropdown selector.\n\nWrite these commands DIRECTLY in your response - do NOT wrap them in code fences or backticks.\n\n### Creating a Document\n\nTo create a new document, include this command directly in your response:\n\n<command:artifact-create>\n<title>Document Title</title>\n<type>md</type>\n<content>\nDocument content here...\n</content>\n</command:artifact-create>\n\nThe type can be:\n- html for HTML documents\n- md for Markdown documents\n- A code language like typescript, python, json, etc. for code files\n\nExample response:\n\"I'll create an RFC document for you.\n\n<command:artifact-create>\n<title>RFC: New Feature</title>\n<type>md</type>\n<content>\n# RFC: New Feature\n\n## Summary\nThis feature will...\n</content>\n</command:artifact-create>\n\nI've created the RFC above. Let me know if you'd like any changes!\"\n\n### Editing a Document\n\nTo make targeted edits to a document, you must specify the exact title of the document you want to edit:\n\n<command:artifact-edit>\n<title>Document Title</title>\n<oldString>text to find</oldString>\n<newString>replacement text</newString>\n<replaceAll>false</replaceAll>\n</command:artifact-edit>\n\n- <title> is required and must match the exact title of an existing document.\n- Set replaceAll to true to replace all occurrences, or false to replace only the first occurrence.\n- If the document title doesn't exist, the edit command will be ignored.\n\nIMPORTANT:\n- Write these commands directly in your response text, NOT inside code blocks or fences.\n- ALWAYS include conversational text before and/or after document commands. Never send a message with only commands and no explanation.\n",
        },
    };

    @node({
        name: 'Chat Model',
        type: '@n8n/n8n-nodes-langchain.lmChatOpenAi',
        version: 1.3,
        position: [608, 304],
        credentials: { openAiApi: { id: 'j32JRKXdMqojFmdN', name: 'OpenAi account' } },
    })
    ChatModel = {
        model: {
            __rl: true,
            mode: 'id',
            value: 'gpt-4.1',
        },
        options: {},
    };

    @node({
        name: 'Memory',
        type: '@n8n/n8n-nodes-langchain.memoryBufferWindow',
        version: 1.3,
        position: [224, 304],
    })
    Memory = {
        sessionIdType: 'customKey',
        sessionKey: "={{ $('When chat message received').item.json.sessionId }}",
        contextWindowLength: 20,
    };

    @node({
        name: 'Restore Chat Memory',
        type: '@n8n/n8n-nodes-langchain.memoryManager',
        version: 1.1,
        position: [-192, 48],
    })
    RestoreChatMemory = {
        mode: 'insert',
        insertMode: 'override',
        messages: {
            messageValues: [],
        },
    };

    @node({
        name: 'Clear Chat Memory',
        type: '@n8n/n8n-nodes-langchain.memoryManager',
        version: 1.1,
        position: [976, 0],
    })
    ClearChatMemory = {
        mode: 'delete',
        deleteMode: 'all',
    };

    @node({
        name: 'Merge',
        type: 'n8n-nodes-base.merge',
        version: 3.2,
        position: [224, -96],
    })
    Merge = {
        mode: 'combine',
        fieldsToMatchString: 'chatInput',
        joinMode: 'enrichInput1',
        options: {},
    };

    @node({
        name: 'Code Tool',
        type: '@n8n/n8n-nodes-langchain.toolCode',
        version: 1.3,
        position: [700, 300],
    })
    CodeTool = {
        notice: '',
        noticeTemplateExample: '',
        description: '',
        language: 'javaScript',
        jsCode: '// Example: convert the incoming query to uppercase and return it\nreturn query.toUpperCase()',
        specifyInputSchema: false,
    };

    // =====================================================================
    // ROUTAGE ET CONNEXIONS
    // =====================================================================

    @links()
    defineRouting() {
        this.WhenChatMessageReceived.out(0).to(this.RestoreChatMemory.in(0));
        this.WhenChatMessageReceived.out(0).to(this.Merge.in(0));
        this.RestoreChatMemory.out(0).to(this.Merge.in(1));
        this.Merge.out(0).to(this.AiAgent.in(0));
        this.AiAgent.out(0).to(this.ClearChatMemory.in(0));

        this.AiAgent.uses({
            ai_languageModel: this.ChatModel.output,
            ai_memory: this.Memory.output,
            ai_tool: [this.CodeTool.output],
        });
        this.RestoreChatMemory.uses({
            ai_memory: this.Memory.output,
        });
        this.ClearChatMemory.uses({
            ai_memory: this.Memory.output,
        });
    }
}
