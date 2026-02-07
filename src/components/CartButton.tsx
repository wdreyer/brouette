"use client";

import { useEffect, useMemo, useState } from "react";
import CartDrawer from "@/components/CartDrawer";
import { getCart, subscribeCart } from "@/lib/cart";

export default function CartButton() {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);
  const [ping, setPing] = useState(false);

  useEffect(() => {
    const update = () => {
      const items = getCart();
      const total = items.reduce((sum, item) => sum + item.quantity, 0);
      setCount(total);
      setPing(true);
      setTimeout(() => setPing(false), 600);
    };

    update();
    const unsubscribe = subscribeCart(update);
    return () => unsubscribe();
  }, []);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="relative inline-flex h-11 w-11 items-center justify-center rounded-full border border-clay/80 bg-white/90 text-ink shadow-sm transition hover:border-ink/40"
        aria-label="Ouvrir le panier"
        id="cart-button"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="9" cy="20" r="1.5" />
          <circle cx="17" cy="20" r="1.5" />
          <path d="M3 4h2l2.4 11.3a2 2 0 0 0 2 1.7h7.7a2 2 0 0 0 2-1.6l1.4-6.4H6.2" />
        </svg>
        {count > 0 ? (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-ember px-1 text-[10px] font-semibold text-white">
            {count}
          </span>
        ) : null}
        {ping ? (
          <span className="absolute -right-1 -top-1 h-5 w-5 animate-ping rounded-full bg-ember/60" />
        ) : null}
      </button>
      <CartDrawer open={open} onClose={() => setOpen(false)} />
    </>
  );
}
