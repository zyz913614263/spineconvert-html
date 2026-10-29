import { defineRule } from "@oxlint/plugins";

import { isGlobalReflectMethodCall } from "../shared/reflect-method.ts";

/** Ban Reflect.apply because it bypasses typed function calls. */
export const noReflectApplyRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "Disallow Reflect.apply; call a typed function or use a named wrapper.",
    },
    messages: {
      reflectApply: "Replace `Reflect.apply` with a typed function call or a named wrapper.",
    },
  },
  createOnce(context) {
    return {
      CallExpression(node) {
        if (node.callee.type === "Super" || node.callee.type === "V8IntrinsicExpression") return;
        if (isGlobalReflectMethodCall(context.sourceCode, node.callee, "apply")) {
          context.report({ node, messageId: "reflectApply" });
        }
      },
    };
  },
});
