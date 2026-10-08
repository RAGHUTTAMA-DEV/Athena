import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs/promises';
import {
  OSAutomationBackend
} from './osAutomationBackend.js';
import {
  ScreenDimensions,
  ScreenRect,
  WindowInfo,
  AccessibilityNode,
  Point,
  MouseButton
} from '../computerTypes.js';

function runPowerShell(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const enc = Buffer.from(script, 'utf16le').toString('base64');
    const child = spawn('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-EncodedCommand',
      enc
    ]);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString('utf-8'); });
    child.stderr.on('data', (d) => { stderr += d.toString('utf-8'); });
    child.on('close', (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`PowerShell script error (code ${code}): ${stderr.trim() || stdout.trim()}`));
    });
  });
}

export class WindowsAutomationBackend implements OSAutomationBackend {
  getPlatform(): 'win32' | 'darwin' | 'linux' {
    return 'win32';
  }

  isSupported(): boolean {
    return process.platform === 'win32';
  }

  getUnsupportedReason(): string | undefined {
    return process.platform === 'win32' ? undefined : 'Windows automation backend requires Windows OS (win32).';
  }

  async getScreenDimensions(): Promise<ScreenDimensions> {
    const script = `
      Add-Type -AssemblyName System.Windows.Forms
      $s = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
      [PSCustomObject]@{
        width = [int]$s.Width
        height = [int]$s.Height
      } | ConvertTo-Json -Compress
    `;
    const out = await runPowerShell(script);
    const parsed = JSON.parse(out);
    return { width: parsed.width, height: parsed.height };
  }

  async captureScreen(options?: { bounds?: ScreenRect; destinationPath?: string }): Promise<{
    savedPath: string;
    width: number;
    height: number;
  }> {
    const saveDir = path.resolve(process.cwd(), 'scratch', 'screenshots');
    await fs.mkdir(saveDir, { recursive: true });

    const targetPath = options?.destinationPath
      ? path.resolve(options.destinationPath)
      : path.join(saveDir, `desktop_${Date.now()}.png`);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });

    const boundsJson = options?.bounds ? JSON.stringify(options.bounds) : 'null';

    const script = `
      Add-Type -AssemblyName System.Windows.Forms
      Add-Type -AssemblyName System.Drawing

      $boundsOption = '${boundsJson.replace(/'/g, "''")}' | ConvertFrom-Json
      if ($boundsOption) {
        $x = [int]$boundsOption.x
        $y = [int]$boundsOption.y
        $w = [int]$boundsOption.width
        $h = [int]$boundsOption.height
      } else {
        $s = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
        $x = [int]$s.X
        $y = [int]$s.Y
        $w = [int]$s.Width
        $h = [int]$s.Height
      }

      $bmp = New-Object System.Drawing.Bitmap $w, $h
      $g = [System.Drawing.Graphics]::FromImage($bmp)
      $g.CopyFromScreen($x, $y, 0, 0, (New-Object System.Drawing.Size $w, $h))

      $targetPath = '${targetPath.replace(/\\/g, '\\\\').replace(/'/g, "''")}'
      $bmp.Save($targetPath, [System.Drawing.Imaging.ImageFormat]::Png)
      $g.Dispose()
      $bmp.Dispose()

      [PSCustomObject]@{
        savedPath = $targetPath
        width = $w
        height = $h
      } | ConvertTo-Json -Compress
    `;

    const out = await runPowerShell(script);
    const parsed = JSON.parse(out);
    return {
      savedPath: parsed.savedPath,
      width: parsed.width,
      height: parsed.height
    };
  }

  async listWindows(): Promise<WindowInfo[]> {
    const script = `
      $procs = Get-Process | Where-Object { $_.MainWindowTitle -ne '' -and $_.MainWindowHandle -ne 0 }
      $results = @()
      foreach ($p in $procs) {
        $results += [PSCustomObject]@{
          id = [string]$p.Id
          handle = [int64]$p.MainWindowHandle
          title = $p.MainWindowTitle
          processName = $p.ProcessName
          processId = [int]$p.Id
          isFocused = $false
        }
      }
      $results | ConvertTo-Json -Compress
    `;
    const out = await runPowerShell(script);
    if (!out) return [];
    try {
      const parsed = JSON.parse(out);
      const list = Array.isArray(parsed) ? parsed : [parsed];
      return list.map(item => ({
        id: String(item.id),
        handle: Number(item.handle),
        title: String(item.title),
        processName: String(item.processName),
        processId: Number(item.processId),
        isFocused: false
      }));
    } catch {
      return [];
    }
  }

  async getActiveWindow(): Promise<WindowInfo | null> {
    const script = `
      $code = @'
      using System;
      using System.Runtime.InteropServices;
      using System.Text;

      public class Win32Active {
        [DllImport("user32.dll")]
        public static extern IntPtr GetForegroundWindow();

        [DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Auto)]
        public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);

        [DllImport("user32.dll", SetLastError=true)]
        public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
      }
'@
      Add-Type -TypeDefinition $code

      $hwnd = [Win32Active]::GetForegroundWindow()
      if ($hwnd -ne [IntPtr]::Zero) {
        $sb = New-Object System.Text.StringBuilder 256
        [void][Win32Active]::GetWindowText($hwnd, $sb, $sb.Capacity)
        $pid = 0
        [void][Win32Active]::GetWindowThreadProcessId($hwnd, [ref]$pid)
        $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue

        [PSCustomObject]@{
          handle = [int64]$hwnd
          id = [string]$pid
          title = $sb.ToString()
          processName = if ($proc) { $proc.ProcessName } else { "unknown" }
          processId = [int]$pid
          isFocused = $true
        } | ConvertTo-Json -Compress
      } else {
        ""
      }
    `;
    const out = await runPowerShell(script);
    if (!out) return null;
    try {
      const parsed = JSON.parse(out);
      return {
        id: String(parsed.id),
        handle: Number(parsed.handle),
        title: String(parsed.title),
        processName: String(parsed.processName),
        processId: Number(parsed.processId),
        isFocused: true
      };
    } catch {
      return null;
    }
  }

  async focusWindow(windowIdOrTitle: string): Promise<boolean> {
    const cleanTarget = windowIdOrTitle.replace(/'/g, "''");
    const script = `
      $code = @'
      using System;
      using System.Runtime.InteropServices;

      public class Win32Focus {
        [DllImport("user32.dll")]
        public static extern bool SetForegroundWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
      }
'@
      Add-Type -TypeDefinition $code

      $target = '${cleanTarget}'
      $hwnd = [IntPtr]::Zero

      # Check if numeric PID / handle
      if ($target -match '^\\d+$') {
        $proc = Get-Process -Id ([int]$target) -ErrorAction SilentlyContinue
        if ($proc -and $proc.MainWindowHandle -ne [IntPtr]::Zero) {
          $hwnd = $proc.MainWindowHandle
        }
      }

      if ($hwnd -eq [IntPtr]::Zero) {
        $proc = Get-Process | Where-Object { $_.MainWindowTitle -like "*$target*" -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1
        if ($proc) {
          $hwnd = $proc.MainWindowHandle
        }
      }

      if ($hwnd -ne [IntPtr]::Zero) {
        [void][Win32Focus]::ShowWindow($hwnd, 9) # SW_RESTORE = 9
        $res = [Win32Focus]::SetForegroundWindow($hwnd)
        Write-Output ($res.ToString().ToLower())
      } else {
        Write-Output "false"
      }
    `;
    const out = await runPowerShell(script);
    return out.trim() === 'true';
  }

  async getAccessibilityTree(options?: {
    windowTitle?: string;
    windowHandle?: number;
    maxDepth?: number;
  }): Promise<AccessibilityNode> {
    const maxDepth = options?.maxDepth ?? 3;
    const title = options?.windowTitle ? options.windowTitle.replace(/'/g, "''") : '';
    const handle = options?.windowHandle ?? 0;

    const script = `
      Add-Type -AssemblyName UIAutomationClient
      Add-Type -AssemblyName UIAutomationTypes

      $root = $null
      if (${handle} -ne 0) {
        $root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]::new([int64]${handle}))
      } elseif ('${title}' -ne '') {
        $cond = New-Object System.Windows.Automation.PropertyCondition(
          [System.Windows.Automation.AutomationElement]::NameProperty,
          '${title}'
        )
        $root = [System.Windows.Automation.AutomationElement]::RootElement.FindFirst(
          [System.Windows.Automation.TreeScope]::Children,
          $cond
        )
      }

      if (-not $root) {
        $root = [System.Windows.Automation.AutomationElement]::RootElement
      }

      function Extract-Node($element, $depth, $max) {
        if (-not $element) { return $null }

        $name = ""
        $role = ""
        $cls = ""
        try { $name = $element.Current.Name } catch {}
        try { $role = $element.Current.ControlType.ProgrammaticName.Replace("ControlType.", "") } catch {}
        try { $cls = $element.Current.ClassName } catch {}

        $rect = $element.Current.BoundingRectangle
        $bounds = $null
        if ($rect -and $rect.Width -gt 0) {
          $bounds = [PSCustomObject]@{
            x = [int]$rect.X
            y = [int]$rect.Y
            width = [int]$rect.Width
            height = [int]$rect.Height
          }
        }

        $children = @()
        if ($depth -lt $max) {
          try {
            $childCol = $element.FindAll(
              [System.Windows.Automation.TreeScope]::Children,
              [System.Windows.Automation.Condition]::TrueCondition
            )
            $count = [Math]::Min($childCol.Count, 25) # Bound children to keep response sized
            for ($i = 0; $i -lt $count; $i++) {
              $childNode = Extract-Node $childCol[$i] ($depth + 1) $max
              if ($childNode) { $children += $childNode }
            }
          } catch {}
        }

        return [PSCustomObject]@{
          name = if ($name) { $name } else { "(unnamed)" }
          role = if ($role) { $role } else { "Element" }
          className = $cls
          bounds = $bounds
          children = $children
        }
      }

      $tree = Extract-Node $root 0 ${maxDepth}
      $tree | ConvertTo-Json -Depth 6 -Compress
    `;

    try {
      const out = await runPowerShell(script);
      if (!out) {
        return { name: 'Desktop', role: 'Pane', children: [] };
      }
      return JSON.parse(out);
    } catch {
      return { name: 'RootElement', role: 'Window', children: [] };
    }
  }

  async mouseMove(x: number, y: number): Promise<void> {
    const script = `
      Add-Type -AssemblyName System.Windows.Forms
      Add-Type -AssemblyName System.Drawing
      [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${Math.round(x)}, ${Math.round(y)})
    `;
    await runPowerShell(script);
  }

  async mouseClick(button: MouseButton = 'left', count: number = 1): Promise<void> {
    const script = `
      $code = @'
      using System;
      using System.Runtime.InteropServices;

      public class Win32Mouse {
        [DllImport("user32.dll")]
        public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, int dwExtraInfo);
      }
'@
      Add-Type -TypeDefinition $code

      # MOUSEEVENTF flags
      # LEFTDOWN = 0x0002, LEFTUP = 0x0004
      # RIGHTDOWN = 0x0008, RIGHTUP = 0x0010
      # MIDDLEDOWN = 0x0020, MIDDLEUP = 0x0040

      $down = 0x0002
      $up = 0x0004
      if ('${button}' -eq 'right') { $down = 0x0008; $up = 0x0010 }
      elseif ('${button}' -eq 'middle') { $down = 0x0020; $up = 0x0040 }

      for ($i = 0; $i -lt ${count}; $i++) {
        [Win32Mouse]::mouse_event($down, 0, 0, 0, 0)
        Start-Sleep -Milliseconds 50
        [Win32Mouse]::mouse_event($up, 0, 0, 0, 0)
        if ($i -lt (${count} - 1)) { Start-Sleep -Milliseconds 100 }
      }
    `;
    await runPowerShell(script);
  }

  async mouseDrag(from: Point, to: Point): Promise<void> {
    const script = `
      Add-Type -AssemblyName System.Windows.Forms
      Add-Type -AssemblyName System.Drawing

      $code = @'
      using System;
      using System.Runtime.InteropServices;

      public class Win32Drag {
        [DllImport("user32.dll")]
        public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, int dwExtraInfo);
      }
'@
      Add-Type -TypeDefinition $code

      [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${Math.round(from.x)}, ${Math.round(from.y)})
      Start-Sleep -Milliseconds 100
      [Win32Drag]::mouse_event(0x0002, 0, 0, 0, 0) # LEFTDOWN
      Start-Sleep -Milliseconds 100

      [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${Math.round(to.x)}, ${Math.round(to.y)})
      Start-Sleep -Milliseconds 100
      [Win32Drag]::mouse_event(0x0004, 0, 0, 0, 0) # LEFTUP
    `;
    await runPowerShell(script);
  }

  async mouseScroll(deltaX: number, deltaY: number): Promise<void> {
    const script = `
      $code = @'
      using System;
      using System.Runtime.InteropServices;

      public class Win32Wheel {
        [DllImport("user32.dll")]
        public static extern void mouse_event(uint dwFlags, int dx, int dy, int dwData, int dwExtraInfo);
      }
'@
      Add-Type -TypeDefinition $code -ErrorAction SilentlyContinue

      # MOUSEEVENTF_WHEEL = 0x0800
      # Negative delta scrolls down
      [Win32Wheel]::mouse_event(0x0800, 0, 0, [int](${Math.round(-deltaY)}), 0)
    `;
    await runPowerShell(script);
  }

  async keyboardType(text: string): Promise<void> {
    // Escape SendKeys special characters: +, ^, %, ~, (, ), {, }, [, ]
    const escaped = text.replace(/([+^%~(){}[\]])/g, '{$1}').replace(/'/g, "''");
    const script = `
      Add-Type -AssemblyName System.Windows.Forms
      [System.Windows.Forms.SendKeys]::SendWait('${escaped}')
    `;
    await runPowerShell(script);
  }

  async keyboardPress(key: string, modifiers: string[] = []): Promise<void> {
    let prefix = '';
    for (const mod of modifiers) {
      const lower = mod.toLowerCase();
      if (lower === 'ctrl' || lower === 'control') prefix += '^';
      else if (lower === 'shift') prefix += '+';
      else if (lower === 'alt') prefix += '%';
    }

    let keySeq = key;
    const lowerKey = key.toLowerCase();
    const map: Record<string, string> = {
      enter: '{ENTER}',
      return: '{ENTER}',
      tab: '{TAB}',
      backspace: '{BACKSPACE}',
      delete: '{DELETE}',
      del: '{DELETE}',
      escape: '{ESC}',
      esc: '{ESC}',
      space: ' ',
      up: '{UP}',
      down: '{DOWN}',
      left: '{LEFT}',
      right: '{RIGHT}',
      home: '{HOME}',
      end: '{END}',
      f1: '{F1}', f2: '{F2}', f3: '{F3}', f4: '{F4}',
      f5: '{F5}', f6: '{F6}', f7: '{F7}', f8: '{F8}',
      f9: '{F9}', f10: '{F10}', f11: '{F11}', f12: '{F12}'
    };

    if (map[lowerKey]) {
      keySeq = map[lowerKey];
    }

    const payload = `${prefix}${keySeq}`.replace(/'/g, "''");
    const script = `
      Add-Type -AssemblyName System.Windows.Forms
      [System.Windows.Forms.SendKeys]::SendWait('${payload}')
    `;
    await runPowerShell(script);
  }
}
