using System;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;
using System.Windows.Forms;

// Observes Windows volume notifications. Does not open, modify, eject, or provision disks.
internal sealed class VolumeWindow : NativeWindow {
    private readonly JavaScriptSerializer json = new JavaScriptSerializer();
    internal VolumeWindow() { CreateHandle(new CreateParams()); Emit("scan", RemovableRoots()); }
    private string[] RemovableRoots() {
        return DriveInfo.GetDrives().Where(d => d.DriveType == DriveType.Removable).Select(d => d.Name).ToArray();
    }
    private void Emit(string kind, string[] roots) { Console.WriteLine(json.Serialize(new { type = kind, roots = roots })); Console.Out.Flush(); }
    protected override void WndProc(ref Message message) {
        const int WM_DEVICECHANGE = 0x219, ARRIVAL = 0x8000, REMOVAL = 0x8004, VOLUME = 2;
        if (message.Msg == WM_DEVICECHANGE && message.LParam != IntPtr.Zero &&
            (message.WParam.ToInt32() == ARRIVAL || message.WParam.ToInt32() == REMOVAL) && Marshal.ReadInt32(message.LParam, 4) == VOLUME) {
            int mask = Marshal.ReadInt32(message.LParam, 12);
            string[] roots = Enumerable.Range(0, 26).Where(i => (mask & (1 << i)) != 0).Select(i => ((char)('A' + i)).ToString() + ":\\").ToArray();
            if (message.WParam.ToInt32() == ARRIVAL) roots = roots.Intersect(RemovableRoots(), StringComparer.OrdinalIgnoreCase).ToArray();
            Emit(message.WParam.ToInt32() == ARRIVAL ? "arrived" : "removed", roots);
        }
        base.WndProc(ref message);
    }
    [STAThread] static void Main() {
        try { using (ApplicationContext context = new ApplicationContext()) { new VolumeWindow(); Application.Run(context); } }
        catch { Console.Error.WriteLine("Native volume notifications unavailable."); Environment.ExitCode = 1; }
    }
}
