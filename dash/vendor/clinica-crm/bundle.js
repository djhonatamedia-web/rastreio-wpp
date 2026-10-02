/* @ds-bundle: {"format":4,"namespace":"ClinicaCRM","components":[{"name":"Button"},{"name":"Badge"},{"name":"Avatar"},{"name":"Icon"},{"name":"Panel"},{"name":"Segmented"},{"name":"Tabs"},{"name":"Field"},{"name":"ChoiceGroup"},{"name":"TimeSlots"},{"name":"Switch"},{"name":"Modal"},{"name":"Toast"},{"name":"EmptyState"},{"name":"Skeleton"},{"name":"Kpi"},{"name":"Funnel"},{"name":"PatientCard"},{"name":"Kanban"},{"name":"FollowUp"},{"name":"Journey"},{"name":"Calendar"},{"name":"TenantSwitcher"},{"name":"Sidebar"},{"name":"TabBar"}]} */
/* Clínica CRM — component library source.
   Plain JS, no JSX, no imports: React and ReactDOM come from the page (window.React).
   Build: the bundle is this file wrapped in an IIFE that assigns window.ClinicaCRM. */
(function () {
  var React = window.React;
  var h = React.createElement;
  var useState = React.useState;
  var useEffect = React.useEffect;

  function cx() {
    var out = [];
    for (var i = 0; i < arguments.length; i++) if (arguments[i]) out.push(arguments[i]);
    return out.join(" ");
  }
  function omit(obj, keys) {
    var o = {};
    for (var k in obj) if (Object.prototype.hasOwnProperty.call(obj, k) && keys.indexOf(k) < 0) o[k] = obj[k];
    return o;
  }

  /* ---------------- Icons ---------------- */
  var ICONS = {
    home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    kanban: '<rect x="3" y="4" width="5" height="16" rx="1.5"/><rect x="10" y="4" width="5" height="10" rx="1.5"/><rect x="17" y="4" width="4" height="13" rx="1.5"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    chat: '<path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.2A8 8 0 1 1 20 12z"/>',
    check: '<path d="M5 12.5 10 17l9-10"/>',
    bell: '<path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15zM10 20a2 2 0 0 0 4 0"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c1-3.5 3.5-5 6.5-5s5.5 1.5 6.5 5M16 4.5a3.5 3.5 0 0 1 0 7M18 15c2 .5 3 2 3.5 5"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>',
    cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/>',
    heart: '<path d="M12 20s-7-4.3-9-9a4.8 4.8 0 0 1 9-3 4.8 4.8 0 0 1 9 3c-2 4.7-9 9-9 9z"/>',
    star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.5 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
    flag: '<path d="M5 21V4h11l-2 4 2 4H5"/>',
    shield: '<path d="M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    building: '<path d="M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16M15 9h4a1 1 0 0 1 1 1v11M3 21h18M8 8h3M8 12h3M8 16h3"/>',
    upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    file: '<path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
    chevronDown: '<path d="m6 9 6 6 6-6"/>',
    chevronLeft: '<path d="m15 6-6 6 6 6"/>',
    chevronRight: '<path d="m9 6 6 6-6 6"/>',
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    filter: '<path d="M3 5h18l-7 8v6l-4 2v-8z"/>',
    download: '<path d="M12 4v12M7 11l5 5 5-5M4 20h16"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
    alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17v.5"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>'
  };
  function Icon(props) {
    var size = props.size || 16;
    return h("svg", {
      className: cx("cl-ico", props.className),
      viewBox: "0 0 24 24",
      width: size, height: size,
      style: { width: size, height: size },
      "aria-hidden": props.label ? undefined : true,
      "aria-label": props.label,
      role: props.label ? "img" : undefined,
      dangerouslySetInnerHTML: { __html: ICONS[props.name] || "" }
    });
  }
  Icon.names = Object.keys(ICONS);

  /* ---------------- Primitives ---------------- */
  function Button(props) {
    var v = props.variant || "secondary";
    var rest = omit(props, ["variant", "size", "icon", "block", "className", "children"]);
    return h("button", Object.assign({ type: "button" }, rest, {
      className: cx("cl-btn", v !== "secondary" && "cl-btn--" + v, props.size === "sm" && "cl-btn--sm", props.block && "cl-btn--block", props.className)
    }), props.icon ? h(Icon, { name: props.icon }) : null, props.children);
  }

  var STAGES = {
    novo: { label: "Novo contato", tone: "neutral" },
    qualificado: { label: "Qualificado", tone: "plum" },
    agendado: { label: "Agendado", tone: "sky" },
    confirmado: { label: "Confirmado", tone: "pine" },
    compareceu: { label: "Compareceu", tone: "pine" },
    tratamento: { label: "Em tratamento", tone: "pine" },
    followup: { label: "Follow-up", tone: "amber" },
    perdido: { label: "Perdido", tone: "rose" },
    noshow: { label: "No-show", tone: "rose" }
  };
  function Badge(props) {
    var tone = props.tone || "neutral";
    var children = props.children;
    if (props.stage && STAGES[props.stage]) { tone = STAGES[props.stage].tone; children = children || STAGES[props.stage].label; }
    return h("span", { className: cx("cl-badge", tone !== "neutral" && "cl-badge--" + tone, props.dot === false && "cl-badge--plain", props.className) }, children);
  }
  Badge.stages = STAGES;
  function Tag(props) { return h("span", { className: cx("cl-tag", props.className) }, props.children); }

  function initials(name) {
    var p = String(name || "").trim().split(/\s+/);
    return ((p[0] || "")[0] || "").toUpperCase() + ((p.length > 1 ? p[p.length - 1][0] : "") || "").toUpperCase();
  }
  function Avatar(props) {
    return h("span", { className: cx("cl-avatar", props.tone && props.tone !== "pine" && "cl-avatar--" + props.tone, props.size === "sm" && "cl-avatar--sm", props.className), title: props.name }, props.initials || initials(props.name));
  }

  function Panel(props) {
    var head = (props.title || props.actions) ? h("div", { className: "cl-panel__head" },
      h("div", null, props.title ? h("h3", { className: "cl-panel__title" }, props.title) : null,
        props.subtitle ? h("div", { className: "cl-panel__sub" }, props.subtitle) : null),
      props.actions || null) : null;
    return h("section", { className: cx("cl-panel", props.className), style: props.style }, head, props.children);
  }

  function Segmented(props) {
    return h("div", { className: "cl-seg", role: "group", "aria-label": props.label },
      props.options.map(function (o) {
        var opt = typeof o === "string" ? { value: o, label: o } : o;
        return h("button", { key: opt.value, type: "button", "aria-pressed": props.value === opt.value ? "true" : "false", onClick: function () { props.onChange && props.onChange(opt.value); } }, opt.label);
      }));
  }

  function Tabs(props) {
    return h("nav", { className: "cl-tabs" }, props.items.map(function (it) {
      var t = typeof it === "string" ? { value: it, label: it } : it;
      return h("a", { key: t.value, href: t.href || "#", "aria-current": props.value === t.value ? "page" : undefined, onClick: function (e) { if (props.onChange) { e.preventDefault(); props.onChange(t.value); } } }, t.label);
    }));
  }

  /* ---------------- Forms ---------------- */
  var fid = 0;
  function Field(props) {
    var idState = useState(function () { fid += 1; return "cl-f" + fid; });
    var id = props.id || idState[0];
    var child = props.children;
    if (React.isValidElement(child)) child = React.cloneElement(child, { id: id, "aria-invalid": props.error ? "true" : undefined });
    return h("div", { className: cx("cl-field", props.wide && "is-wide") },
      h("label", { className: "cl-field__label", htmlFor: id }, props.label, props.optional ? h("span", { className: "cl-muted", style: { fontWeight: 400 } }, " (opcional)") : null),
      child,
      props.error ? h("span", { className: "cl-field__error", role: "alert" }, props.error) : (props.hint ? h("span", { className: "cl-field__hint" }, props.hint) : null));
  }
  function Input(props) { return h("input", Object.assign({}, props, { className: cx("cl-input", props.className) })); }
  function Textarea(props) { return h("textarea", Object.assign({}, props, { className: cx("cl-textarea", props.className) })); }
  function Select(props) {
    var rest = omit(props, ["options", "className"]);
    return h("select", Object.assign({}, rest, { className: cx("cl-select", props.className) }), (props.options || []).map(function (o) {
      var opt = typeof o === "string" ? { value: o, label: o } : o;
      return h("option", { key: opt.value, value: opt.value }, opt.label);
    }));
  }
  function Switch(props) {
    var input = h("input", { type: "checkbox", className: "cl-switch", checked: !!props.checked, onChange: function (e) { props.onChange && props.onChange(e.target.checked); }, "aria-label": props.label ? undefined : props.ariaLabel });
    if (!props.label) return input;
    return h("label", { className: "cl-setting", style: props.bare ? { padding: 0, border: 0 } : undefined },
      h("div", null, h("div", { className: "cl-setting__title" }, props.label), props.description ? h("div", { className: "cl-setting__sub" }, props.description) : null), input);
  }
  function ChoiceGroup(props) {
    return h("div", { className: "cl-choices", role: "radiogroup", "aria-label": props.label }, props.options.map(function (o) {
      var opt = typeof o === "string" ? { value: o, label: o } : o;
      return h("button", { key: opt.value, type: "button", role: "radio", className: "cl-choice", "aria-checked": props.value === opt.value ? "true" : "false", onClick: function () { props.onChange && props.onChange(opt.value); } }, opt.label);
    }));
  }
  function TimeSlots(props) {
    return h("div", { className: "cl-slots", role: "radiogroup", "aria-label": props.label || "Horários", style: props.columns ? { gridTemplateColumns: "repeat(" + props.columns + ", 1fr)" } : undefined }, props.slots.map(function (s) {
      var slot = typeof s === "string" ? { time: s } : s;
      return h("button", { key: slot.time, type: "button", role: "radio", className: "cl-slot", disabled: !!slot.disabled, "aria-checked": props.value === slot.time ? "true" : "false", onClick: function () { props.onChange && props.onChange(slot.time); } }, slot.time);
    }));
  }

  /* ---------------- Overlays & feedback ---------------- */
  function Modal(props) {
    useEffect(function () {
      if (!props.open || !props.onClose) return;
      function onKey(e) { if (e.key === "Escape") props.onClose(); }
      document.addEventListener("keydown", onKey);
      return function () { document.removeEventListener("keydown", onKey); };
    }, [props.open]);
    if (!props.open) return null;
    return h("div", { className: "cl-scrim", style: props.inline ? undefined : { position: "fixed", inset: 0, zIndex: 50, borderRadius: 0 }, onClick: function (e) { if (e.target === e.currentTarget && props.onClose) props.onClose(); } },
      h("div", { className: "cl-modal", role: "dialog", "aria-modal": "true", "aria-label": props.title, style: props.width ? { maxWidth: props.width } : undefined },
        h("div", { className: "cl-modal__head" }, h("h2", { className: "cl-modal__title" }, props.title),
          props.onClose ? h(Button, { variant: "ghost", size: "sm", "aria-label": "Fechar", onClick: props.onClose }, h(Icon, { name: "close" })) : null),
        h("div", { className: "cl-modal__body" }, props.children),
        props.footer ? h("div", { className: "cl-modal__foot" }, props.note ? h("span", { className: "cl-modal__note" }, props.note) : null, props.footer) : null));
  }
  function Toast(props) {
    var tone = props.tone || "success";
    var icon = tone === "warn" ? "clock" : tone === "error" ? "close" : "check";
    return h("div", { className: cx("cl-toast", tone === "warn" && "cl-toast--warn", tone === "error" && "cl-toast--err"), role: tone === "error" ? "alert" : "status" },
      h("span", { className: "cl-toast__icon" }, h(Icon, { name: icon })), h("span", null, props.children),
      props.action ? h("button", { className: "cl-toast__act", onClick: props.onAction }, props.action) : null);
  }
  function EmptyState(props) {
    return h("div", { className: "cl-empty" }, h("span", { className: "cl-empty__icon" }, h(Icon, { name: props.icon || "info" })),
      h("div", { className: "cl-empty__title" }, props.title), props.text ? h("div", { className: "cl-empty__text" }, props.text) : null, props.action || null);
  }
  function Skeleton(props) {
    return h("span", { className: "cl-skel", style: { width: props.width || "100%", height: props.height || 12, borderRadius: props.round ? 999 : undefined } });
  }

  /* ---------------- Data display ---------------- */
  function Kpi(props) {
    var good = props.good || "up";
    var dir = props.trend;
    var cls = !dir || dir === "neutral" ? null : ((dir === good) ? "cl-kpi__delta--up" : "cl-kpi__delta--down");
    return h("div", { className: "cl-kpi" },
      h("span", { className: "cl-label" }, props.label),
      h("div", { className: "cl-kpi__value", style: props.alert ? { color: "var(--rose)" } : undefined }, props.prefix ? h("small", null, props.prefix) : null, props.value, props.suffix ? h("small", null, " " + props.suffix) : null),
      props.delta || props.note ? h("span", { className: cx("cl-kpi__delta", cls), style: cls ? undefined : { color: "var(--ink-muted)", fontWeight: 500 } },
        props.delta ? (dir === "down" ? "↓ " : dir === "up" ? "↑ " : "") + props.delta + " " : null, props.note ? h("span", null, props.note) : null) : null);
  }
  function KpiRow(props) { return h("div", { className: "cl-kpis" }, props.children); }

  var ORIGINS = [{ key: "ads", label: "Anúncios", color: "var(--sky)" }, { key: "org", label: "Orgânico", color: "var(--pine)" }, { key: "ref", label: "Indicação", color: "var(--plum)" }];
  function Legend(props) {
    return h("div", { className: "cl-legend" }, (props.items || ORIGINS).map(function (o) { return h("span", { key: o.label }, h("i", { style: { background: o.color } }), o.label); }));
  }
  function Funnel(props) {
    var max = props.stages.length ? props.stages[0].total : 1;
    var rows = [];
    props.stages.forEach(function (s, i) {
      if (i > 0) {
        var prev = props.stages[i - 1].total || 1;
        rows.push(h("div", { className: "cl-funnel__row", key: "s" + i }, h("span"), h("div", { className: "cl-funnel__step" }, h("b", null, Math.round(s.total / prev * 100) + "%"), " avançaram"), h("span")));
      }
      var segs = s.segments ? ORIGINS.map(function (o) {
        var v = s.segments[o.key] || 0;
        return v ? h("div", { key: o.key, className: "cl-funnel__bar cl-funnel__bar--" + o.key, style: { width: (v / max * 100) + "%" }, title: o.label + ": " + v }) : null;
      }) : [h("div", { key: "t", className: "cl-funnel__bar cl-funnel__bar--org", style: { width: (s.total / max * 100) + "%" } })];
      rows.push(h("div", { className: "cl-funnel__row", key: "r" + i }, h("span", { className: "cl-funnel__name" }, s.name), h("div", { className: "cl-funnel__track" }, segs), h("span", { className: "cl-funnel__num" }, s.total)));
    });
    return h("div", { className: "cl-funnel" }, rows);
  }

  function PatientCard(props) {
    var p = props.patient;
    var next = p.next || {};
    return h("article", { className: cx("cl-card", props.dragging && "is-dragging"), draggable: props.draggable !== false, onDragStart: props.onDragStart, onDragEnd: props.onDragEnd, onClick: props.onOpen },
      h("div", { className: "cl-card__top" }, h(Avatar, { name: p.name, tone: p.tone }),
        h("div", null, h("div", { className: "cl-card__name" }, p.name), p.procedure ? h("div", { className: "cl-card__proc" }, p.procedure) : null),
        p.value ? h("span", { className: "cl-card__value" }, p.value) : null),
      (p.tags && p.tags.length) || p.badge ? h("div", { className: "cl-card__meta" }, p.badge ? h(Badge, p.badge) : null, (p.tags || []).slice(0, 3).map(function (t) { return h(Tag, { key: t }, t); })) : null,
      h("div", { className: "cl-card__foot" }, h("span", { className: "cl-card__next cl-card__next--" + (next.status || "ok") }, h(Icon, { name: "clock" }), next.label || "Definir próxima ação"),
        p.owner ? h(Avatar, { name: p.owner, size: "sm", className: "", initials: p.ownerInitials }) : null));
  }

  function Kanban(props) {
    var st = useState(props.columns);
    var cols = st[0], setCols = st[1];
    var drag = useState(null); var over = useState(null);
    useEffect(function () { setCols(props.columns); }, [props.columns]);
    function drop(toId) {
      var d = drag[0]; over[1](null); if (!d || d.from === toId) return;
      var card;
      var next = cols.map(function (c) {
        if (c.id === d.from) { return Object.assign({}, c, { cards: c.cards.filter(function (x) { if (x.id === d.id) { card = x; return false; } return true; }) }); }
        return c;
      }).map(function (c) { return c.id === toId && card ? Object.assign({}, c, { cards: c.cards.concat([card]) }) : c; });
      setCols(next); drag[1](null);
      props.onMove && props.onMove(d.id, d.from, toId);
    }
    return h("div", { className: "cl-board" }, cols.map(function (c) {
      return h("section", { key: c.id, className: cx("cl-col", over[0] === c.id && "is-over"),
        onDragOver: function (e) { e.preventDefault(); if (over[0] !== c.id) over[1](c.id); },
        onDragLeave: function () { over[1](null); },
        onDrop: function (e) { e.preventDefault(); drop(c.id); } },
        h("div", { className: "cl-col__head" }, h("span", { className: "cl-col__dot", style: { background: c.color || "var(--ink-subtle)" } }), h("span", { className: "cl-col__name" }, c.name), h("span", { className: "cl-col__count" }, c.cards.length)),
        c.summary ? h("div", { className: "cl-col__sum" }, c.summary) : null,
        c.cards.map(function (p) {
          return h(PatientCard, { key: p.id, patient: p, dragging: drag[0] && drag[0].id === p.id,
            onDragStart: function (e) { e.dataTransfer && e.dataTransfer.setData("text/plain", p.id); drag[1]({ id: p.id, from: c.id }); },
            onDragEnd: function () { drag[1](null); over[1](null); } });
        }),
        props.onAdd ? h("button", { className: "cl-col__add", type: "button", onClick: function () { props.onAdd(c.id); } }, "+ Adicionar paciente") : null);
    }));
  }

  var HOUR = 56;
  function Calendar(props) {
    var start = props.startHour == null ? 8 : props.startHour;
    var end = props.endHour == null ? 19 : props.endHour;
    var hours = []; for (var x = start; x < end; x++) hours.push(x);
    var days = props.days;
    function pad(n) { return (n < 10 ? "0" : "") + n; }
    return h("div", { className: "cl-cal", style: { "--days": days.length } },
      h("div", { className: "cl-cal__corner" }),
      days.map(function (d, i) { return h("div", { key: "h" + i, className: cx("cl-cal__dayhead", d.today && "is-today") }, h("b", null, d.date), h("span", { className: "cl-muted cl-small" }, d.label)); }),
      h("div", { className: "cl-cal__hours" }, hours.map(function (hr) { return h("span", { key: hr }, pad(hr) + ":00"); })),
      days.map(function (d, i) {
        return h("div", { key: "d" + i, className: "cl-cal__day", style: { height: hours.length * HOUR } },
          d.today && props.now != null ? h("div", { className: "cl-cal__now", style: { top: (props.now - start) * HOUR } }) : null,
          (props.events || []).filter(function (e) { return e.day === i; }).map(function (e, j) {
            return h("div", { key: j, className: "cl-ev cl-ev--" + (e.type || "consulta"), style: { top: (e.start - start) * HOUR + 2, height: e.duration * HOUR - 4 }, onClick: e.onClick },
              e.confirmed && e.type !== "pendente" ? h("span", { className: "cl-ev__ok", title: "Confirmado" }, "✓") : null, h("b", null, e.title), e.detail);
          }));
      }));
  }

  function FollowUp(props) {
    var color = { late: "var(--rose)", soon: "var(--amber)", ok: "var(--ink-muted)" };
    return h("div", { className: "cl-tasks" }, props.tasks.map(function (t) {
      return h("label", { key: t.id, className: cx("cl-task", t.done && "is-done") },
        h("input", { type: "checkbox", className: "cl-check", checked: !!t.done, onChange: function (e) { props.onToggle && props.onToggle(t.id, e.target.checked); } }),
        h("div", null, h("div", { className: "cl-task__title" }, t.title), t.detail ? h("div", { className: "cl-task__sub" }, t.detail) : null),
        h("span", { className: "cl-task__when", style: { color: color[t.status || "ok"] } }, t.due));
    }));
  }

  function Journey(props) {
    return h("ol", { className: "cl-journey" }, props.steps.map(function (s, i) {
      return h("li", { key: i, className: "cl-step cl-step--" + (s.state || "done") },
        h("span", { className: "cl-step__dot" }, h(Icon, { name: s.icon || "check" })),
        h("div", null, h("div", { className: "cl-step__title" }, s.title), s.body ? h("div", { className: "cl-step__body" }, s.body) : null),
        h("span", { className: "cl-step__time" }, s.time || ""));
    }));
  }

  /* ---------------- Navigation & multitenant ---------------- */
  function TenantSwitcher(props) {
    var t = props.tenant;
    var st = useState(!!props.defaultOpen); var open = st[0], setOpen = st[1];
    var logo = function (x) { return h("span", { className: cx("cl-tenant__logo", x.tone && "cl-tenant__logo--" + x.tone) }, x.initials || initials(x.name)); };
    return h("div", { style: { position: "relative" } },
      h("button", { type: "button", className: "cl-tenant", "aria-haspopup": "menu", "aria-expanded": open, onClick: function () { setOpen(!open); } },
        logo(t), h("span", { className: "cl-tenant__txt" }, h("b", null, t.name), h("span", null, t.unit || "Todas as unidades")), h("span", { className: "cl-tenant__chev", "aria-hidden": true }, "⌄")),
      open ? h("div", { className: "cl-menu", role: "menu", style: props.inlineMenu ? { marginTop: 4 } : { position: "absolute", top: "100%", left: 0, marginTop: 4, zIndex: 40 } },
        h("div", { className: "cl-menu__label cl-label" }, t.name + " · unidades"),
        (props.units || []).map(function (u) {
          return h("a", { key: u.name, className: "cl-menu__item", role: "menuitem", "aria-current": u.name === t.unit ? "true" : undefined, onClick: function () { setOpen(false); props.onSelectUnit && props.onSelectUnit(u.name); } }, logo(t), u.name, h("small", null, u.name === t.unit ? "atual" : (u.note || "")));
        }),
        props.others && props.others.length ? [h("div", { key: "s1", className: "cl-menu__sep" }), h("div", { key: "l2", className: "cl-menu__label cl-label" }, "Outras clínicas em que você atua")].concat(props.others.map(function (o) {
          return h("a", { key: o.name, className: "cl-menu__item", role: "menuitem", onClick: function () { setOpen(false); props.onSelectTenant && props.onSelectTenant(o.name); } }, logo(o), o.name, h("small", null, o.role || ""));
        })) : null,
        h("div", { className: "cl-menu__sep" }),
        h("a", { className: "cl-menu__item", role: "menuitem" }, h(Icon, { name: "settings" }), "Configurações da clínica"),
        h("a", { className: "cl-menu__item", role: "menuitem" }, h(Icon, { name: "plus" }), "Criar nova clínica")) : null);
  }

  function Sidebar(props) {
    function item(it) {
      return h("a", { key: it.id, href: it.href || "#", "aria-current": props.active === it.id ? "page" : undefined, onClick: function (e) { if (props.onNavigate) { e.preventDefault(); props.onNavigate(it.id); } } },
        h(Icon, { name: it.icon }), it.label, it.count ? h("em", null, it.count) : null);
    }
    return h("aside", { className: cx("cl-side", props.platform && "cl-side--platform"), style: props.style },
      h("div", { className: "cl-brand" }, h("span", { className: "cl-brand__mark" }, h(Icon, { name: "heart" })), h("span", { className: "cl-brand__name" }, props.productName || "Clínica CRM")),
      props.platform ? h("span", { className: "cl-envtag" }, "Plataforma") : null,
      props.tenant ? h(TenantSwitcher, { tenant: props.tenant, units: props.units, others: props.others }) : null,
      h("nav", { className: "cl-nav" }, (props.items || []).map(item),
        props.secondary && props.secondary.length ? [h("div", { key: "g", className: "cl-nav__group cl-label" }, props.secondaryLabel || "Gestão")].concat(props.secondary.map(item)) : null),
      props.user ? h("div", { className: "cl-side__foot" }, h(Avatar, { name: props.user.name, initials: props.user.initials }), h("div", null, h("div", { style: { fontWeight: 600 } }, props.user.name), h("div", { className: "cl-small cl-muted" }, props.user.role))) : null);
  }

  function TabBar(props) {
    return h("nav", { className: "cl-tabbar" }, props.items.map(function (it) {
      return h("a", { key: it.id, href: "#", "aria-current": props.active === it.id ? "page" : undefined, onClick: function (e) { e.preventDefault(); props.onChange && props.onChange(it.id); } },
        h(Icon, { name: it.icon, size: 22 }), it.label, it.count ? h("em", null, it.count) : null);
    }));
  }

  var api = {
    Icon: Icon, Button: Button, Badge: Badge, Tag: Tag, Avatar: Avatar, Panel: Panel, Segmented: Segmented, Tabs: Tabs,
    Field: Field, Input: Input, Textarea: Textarea, Select: Select, Switch: Switch, ChoiceGroup: ChoiceGroup, TimeSlots: TimeSlots,
    Modal: Modal, Toast: Toast, EmptyState: EmptyState, Skeleton: Skeleton,
    Kpi: Kpi, KpiRow: KpiRow, Legend: Legend, Funnel: Funnel, PatientCard: PatientCard, Kanban: Kanban, Calendar: Calendar,
    FollowUp: FollowUp, Journey: Journey, TenantSwitcher: TenantSwitcher, Sidebar: Sidebar, TabBar: TabBar
  };
  window.ClinicaCRM = Object.assign(window.ClinicaCRM || {}, api);
})();
