import os
import RPi.GPIO as GPIO

def button_callback(channel):
  print("Button was pushed!")
  os.system("uhubctl -l 1-1 -p 2 -a toggle")

GPIO.setwarnings(False)
GPIO.setmode(GPIO.BOARD)
GPIO.setup(10, GPIO.IN, pull_up_down=GPIO.PUD_DOWN)

GPIO.add_event_detect(10, GPIO.RISING, callback=button_callback, bouncetime=1000)

message = input("Press enter to quit\n")
GPIO.cleanup()
