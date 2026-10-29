import { defineRule } from "@oxlint/plugins";

import { isGlobalReflectMethodCall } from "../shared/reflect-method.ts";

/** Ban Reflect.get because it bypasses typed property access. */
export const noReflectGetRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "Disallow Reflect.get; use typed property access or validate dynamic input.",
    },
    messages: {
      reflectGet: "Replace `Reflect.get` with typed property access. Validate dynamic input first.",
    },
  },
  createOnce(context) {
    return {
      CallExpression(node) {
        if (node.callee.type === "Super" || node.callee.type === "V8IntrinsicExpression") return;
        if (isGlobalReflectMethodCall(context.sourceCode, node.callee, "get")) {
          context.report({ node, messageId: "reflectGet" });
        }
      },
    };
  },
});
