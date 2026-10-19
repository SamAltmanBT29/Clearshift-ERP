🚨 CRITICAL NOTICE: Frontend Standards for ERP & CRM (No Basic HTML/CSS) 🚨
Team, a quick and very important directive for everyone building frontend screens:
Please DO NOT use basic, simple HTML and ad-hoc inline CSS. We are not building a simple demo or a plain toy website;
this is an enterprise-grade platform that clients and evaluators will judge on design precision, structure, and polish.
Everything must be properly structured, architected, and maintained. Please strictly follow these rules:
1. 🛑 Stop Writing Ad-Hoc CSS — Stick to Global :root & theme.css
Never hardcode arbitrary colors or random margins inside individual components.
Everything must inherit from our global :root variables ( globals.css / theme.css ):
Use --color-background , --color-text , --border-subtle , --font-sans , and --radius-md .
If a common style (card, badge, table, input) is needed, use the base classes or pull directly from the shared
@clearshift/ui package.
2. ️ Professional Component Architecture
No "Plain HTML" Look: Unstyled buttons, browser-default form fields, or plain unpadded tables are unacceptable.
Semantic & Modern: Use modern typography, clean borders ( #e5e7eb ), crisp whitespace, and subtle hover/focus states.
Component Modularity: Break down large screens into small, reusable components (e.g. DataTable , FilterBar ,
StatusBadge , Modal ).
3. ️ Mandatory Polish on Every Page
Every single page must look and feel like a real SaaS application (Stripe / Linear / Notion style):
⏳ Skeleton loaders when fetching data.
📄 Polished Empty States with icons and clear action buttons.
⚠️ Handled Error States with retry buttons.
📱 Flawless Layouts: No awkward text cutoffs, broken tables, or horizontal scrolling overflows.
Bottom line: Any PR with basic, messy HTML or unorganized CSS will not be approved. Take the time to make your
screens clean, minimal, responsive, and properly structured.