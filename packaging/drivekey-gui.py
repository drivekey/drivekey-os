#!/usr/bin/python3
"""Offline Tk interface. No networking, browser, server, telemetry or key display.
Cryptography runs in a short-lived bundled Node process over anonymous pipes.
"""
import datetime
import json
import queue
import subprocess
import threading
import tkinter as tk
from tkinter import messagebox

BG, PANEL, FG, MUTED, GREEN = "#080e0c", "#12201a", "#edf6f0", "#a3b8ab", "#b7f4ce"


class DriveKey:
    def __init__(self, root):
        self.root, self.busy, self.review = root, False, None
        self.results = queue.Queue()
        self.exit_code = 0
        root.title("DriveKey — offline signer")
        root.configure(bg=BG)
        root.geometry("1080x760")
        root.minsize(820, 600)
        root.protocol("WM_DELETE_WINDOW", self.shutdown)
        self.clock = tk.StringVar()
        self.message = tk.StringVar(value="Checking the offline environment…")
        self.address = tk.StringVar(value="No vault loaded")
        self.passphrase, self.confirmation = tk.StringVar(), tk.StringVar()
        self.consent = tk.BooleanVar(value=False)
        header = tk.Frame(root, bg=BG, padx=28, pady=18)
        header.pack(fill="x")
        self.label(header, "DRIVEKEY", 24, GREEN).pack(side="left")
        self.label(header, "OFFLINE SIGNER · PROTOTYPE", 11).pack(side="left", padx=24)
        self.label(header, textvariable=self.clock, size=10).pack(side="right")
        nav = tk.Frame(root, bg=BG, padx=28)
        nav.pack(fill="x")
        self.buttons = []
        for text, tab in [("1  Vault", "vault"), ("2  Review & sign", "sign"), ("3  Backup & recovery", "backup")]:
            self.button(nav, text, lambda t=tab: self.show(t)).pack(side="left", padx=(0, 10))
        self.button(nav, "Safe shutdown", self.shutdown).pack(side="right")
        outer = tk.Frame(root, bg=BG, padx=28, pady=16)
        outer.pack(fill="both", expand=True)
        self.canvas = tk.Canvas(outer, bg=PANEL, highlightthickness=0)
        scroll = tk.Scrollbar(outer, orient="vertical", command=self.canvas.yview)
        self.canvas.configure(yscrollcommand=scroll.set)
        scroll.pack(side="right", fill="y")
        self.canvas.pack(side="left", fill="both", expand=True)
        self.body = tk.Frame(self.canvas, bg=PANEL, padx=24, pady=18)
        self.window = self.canvas.create_window((0, 0), window=self.body, anchor="nw")
        self.body.bind("<Configure>", lambda _: self.canvas.configure(scrollregion=self.canvas.bbox("all")))
        self.canvas.bind("<Configure>", lambda event: self.canvas.itemconfigure(self.window, width=event.width))
        self.canvas.bind_all("<MouseWheel>", lambda event: self.canvas.yview_scroll(-int(event.delta / 120), "units"))
        footer = tk.Frame(root, bg=BG, padx=28, pady=12)
        footer.pack(fill="x")
        self.label(footer, textvariable=self.message, size=12, color=GREEN, wraplength=1000).pack(anchor="w")
        self.label(footer, "Keep the USB connected until the PC is fully off. A normal USB is copyable; this is not a secure-element wallet.", 10, MUTED, wraplength=1000).pack(anchor="w", pady=(8, 0))
        self.tab = "vault"
        self.show("vault")
        self.tick()
        self.root.after(80, self.poll)
        self.call({"action": "status"})

    def label(self, parent, text="", size=12, color=FG, **options):
        return tk.Label(parent, text=text, font=("DejaVu Sans", size), bg=parent.cget("bg"), fg=color, justify="left", anchor="w", **options)

    def button(self, parent, text, command):
        b = tk.Button(parent, text=text, command=command, bg=GREEN, fg=BG, activebackground="#ddffe9", relief="flat", padx=16, pady=10, font=("DejaVu Sans", 11), cursor="hand2", disabledforeground="#73897b")
        self.buttons.append(b)
        return b

    def paragraph(self, text, color=MUTED):
        self.label(self.body, text, 12, color, wraplength=900).pack(anchor="w", pady=(4, 14))

    def entry(self, label, variable, parent=None):
        parent = parent or self.body
        self.label(parent, label, 11, MUTED).pack(anchor="w", pady=(8, 5))
        e = tk.Entry(parent, textvariable=variable, show="●", bg=BG, fg=FG, insertbackground=GREEN, relief="flat", font=("DejaVu Sans", 14))
        e.pack(fill="x", ipady=10, pady=(0, 8))
        return e

    def show(self, tab):
        if self.busy:
            return
        self.tab = tab
        self.passphrase.set(""); self.confirmation.set(""); self.consent.set(False)
        self.review = None
        for child in self.body.winfo_children():
            child.destroy()
        self.buttons = [b for b in self.buttons if b.winfo_exists()]
        self.canvas.yview_moveto(0)
        self.label(self.body, textvariable=self.address, size=12, color=GREEN, wraplength=900).pack(anchor="w", pady=(0, 16))
        if tab == "vault":
            self.label(self.body, "Your keys stay in this offline session", 21).pack(anchor="w")
            self.paragraph("Create a vault once. Use a unique passphrase of 16–256 characters, then verify it. Existing vault files are never overwritten. Only wallet-public.json belongs on the website.")
            self.entry("Vault passphrase", self.passphrase)
            self.entry("Repeat passphrase (new vault only)", self.confirmation)
            row = tk.Frame(self.body, bg=PANEL); row.pack(anchor="w", pady=14)
            self.button(row, "Create new vault", self.create).pack(side="left", padx=(0, 12))
            self.button(row, "Verify passphrase", lambda: self.password_action("check")).pack(side="left", padx=(0, 12))
            self.button(row, "Export public file", lambda: self.call({"action": "export-public"})).pack(side="left")
            self.paragraph("There is no password reset. Losing both the passphrase and usable backup means losing access. This computer and its firmware must be trusted; booting Linux is not proof that the machine is clean.")
        elif tab == "sign":
            self.label(self.body, "Review an exact payment", 21).pack(anchor="w")
            self.paragraph("Save unsigned-request.json in the USB’s DriveKey folder from Windows, then boot offline. The signer checks the file before displaying it. Never change the clock or edit the file to bypass expiry.")
            self.button(self.body, "Load transaction details", lambda: self.call({"action": "review"})).pack(anchor="w", pady=8)
            self.details = tk.Frame(self.body, bg=PANEL); self.details.pack(fill="x")
        else:
            self.label(self.body, "Check your recovery before you need it", 21).pack(anchor="w")
            self.paragraph("Create an encrypted vault-backup.json here, shut down, then keep a separate copy in a safe location. A backup on this USB alone does not protect against drive loss. Never upload a vault file or passphrase to the website.")
            self.entry("Vault / backup passphrase", self.passphrase)
            row = tk.Frame(self.body, bg=PANEL); row.pack(anchor="w", pady=14)
            self.button(row, "Create encrypted backup", lambda: self.password_action("backup")).pack(side="left", padx=(0, 12))
            self.button(row, "Verify backup", lambda: self.password_action("check-backup")).pack(side="left")
            self.paragraph("Restore only on an empty configured USB: place vault-backup.json in its DriveKey folder, boot offline, then restore. A different or existing vault is never replaced.")
            self.button(self.body, "Restore on empty USB", self.restore).pack(anchor="w")

    def create(self):
        if messagebox.askyesno("Create vault", "Create a NEW vault on this USB? Keep your unique passphrase safe. There is no reset.", parent=self.root):
            self.call({"action": "create", "password": self.passphrase.get(), "confirmation": self.confirmation.get(), "consent": True})

    def restore(self):
        if messagebox.askyesno("Restore backup", "Restore vault-backup.json? This only works when no existing vault or public metadata is present.", parent=self.root):
            self.call({"action": "restore", "password": self.passphrase.get(), "consent": True})

    def password_action(self, action):
        self.call({"action": action, "password": self.passphrase.get()})

    def render_review(self, review):
        self.review = review
        for child in self.details.winfo_children(): child.destroy()
        for key, name in [("recipient", "FULL RECIPIENT"), ("from", "FROM"), ("network", "NETWORK"), ("amount", "AMOUNT"), ("maximumFee", "MAXIMUM FEE"), ("maximumDebit", "MAXIMUM TOTAL DEBIT"), ("nonce", "NONCE"), ("deadlineUTC", "DEADLINE · UTC"), ("requestId", "REQUEST ID"), ("fingerprint", "FINGERPRINT")]:
            self.label(self.details, name, 10, MUTED).pack(anchor="w", pady=(10, 2))
            self.label(self.details, str(review[key]), 12, FG, wraplength=880).pack(anchor="w")
        check = tk.Checkbutton(self.details, text="I verified the full recipient, network, amount and maximum fee independently.", variable=self.consent, bg=PANEL, fg=FG, selectcolor=BG, activebackground=PANEL, activeforeground=FG, wraplength=880, justify="left", font=("DejaVu Sans", 11))
        check.pack(anchor="w", pady=14)
        self.entry("Vault passphrase — used locally only", self.passphrase, self.details)
        self.button(self.details, "Approve & sign exact transaction", self.sign).pack(anchor="w", pady=12)
        self.label(self.details, "Signing authorizes this payment. Anyone with the signed bytes can submit it, even after the app deadline. The signed response is not an encrypted vault and contains no private key.", 11, MUTED, wraplength=880).pack(anchor="w", pady=12)
        self.buttons = [b for b in self.buttons if b.winfo_exists()]

    def sign(self):
        if not self.review or not self.consent.get():
            self.message.set("Load and verify the transaction details, then check the approval box.")
            return
        self.call({"action": "sign", "fingerprint": self.review["fingerprint"], "password": self.passphrase.get(), "consent": True})

    def call(self, payload):
        if self.busy: return
        self.busy = True
        self.passphrase.set(""); self.confirmation.set("")
        for button in self.buttons:
            button.configure(state="disabled")
        self.message.set("Working locally. Keep this USB connected…")
        def work():
            try:
                result = subprocess.run(["/opt/drivekey/node/bin/node", "/opt/drivekey/drivekey-gui-worker.cjs"], input=json.dumps(payload), text=True, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=120, check=False)
                reply = json.loads(result.stdout) if len(result.stdout) <= 32768 else {"ok": False}
            except Exception:
                reply = {"ok": False, "error": "Operation stopped. Check files and drive space, then retry. No automatic retry was attempted."}
            finally:
                payload.clear()
            self.results.put(reply)
        threading.Thread(target=work, daemon=True).start()

    def poll(self):
        try:
            result = self.results.get_nowait()
            self.busy = False
            for button in self.buttons:
                if button.winfo_exists(): button.configure(state="normal")
            self.message.set(result.get("message", "") if result.get("ok") else result.get("error", "Operation stopped."))
            if result.get("wallet"): self.address.set(result["wallet"]["address"])
            if result.get("review"): self.render_review(result["review"])
            if result.get("hash"):
                self.review = None; self.consent.set(False)
                messagebox.showinfo("Signed — not sent", "signed-response.json saved.\n\nTransaction hash:\n" + result["hash"] + "\n\nUse Safe shutdown. In Windows upload the response to the same website and review before sending.", parent=self.root)
        except queue.Empty:
            pass
        self.root.after(80, self.poll)

    def tick(self):
        self.clock.set(datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d  %H:%M:%S UTC"))
        self.root.after(1000, self.tick)

    def shutdown(self):
        if self.busy:
            self.message.set("Wait for the current operation to finish before shutdown.")
            return
        if messagebox.askyesno("Safe shutdown", "Flush files, unmount the USB exchange partition and fully power off? Do not remove the USB until the PC is off.", parent=self.root):
            self.passphrase.set(""); self.confirmation.set("")
            self.exit_code = 42
            self.root.destroy()


if __name__ == "__main__":
    root = tk.Tk()
    app = DriveKey(root)
    root.mainloop()
    raise SystemExit(app.exit_code)
