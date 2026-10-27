output "public_ip" {
  value = aws_eip.nexus.public_ip
}

output "players_url" {
  value = "http://${aws_eip.nexus.public_ip}/"
}

output "screen_url" {
  value = "http://${aws_eip.nexus.public_ip}/screen?join=http://${aws_eip.nexus.public_ip}/"
}

output "admin_url" {
  value = "http://${aws_eip.nexus.public_ip}/admin"
}

output "ssh" {
  value = "ssh ubuntu@${aws_eip.nexus.public_ip}"
}
